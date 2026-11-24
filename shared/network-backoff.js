// shared/network-backoff.js
// CineGlow Pro for YouTube - Exponential Backoff Utility
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)

(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BACKOFF_CONFIG = Object.freeze({
    initialDelayMs: 1000,
    maxDelayMs: 16000,
    maxRetries: 3,
    jitterRatio: 0.2,
    retryOnStatus: Object.freeze([429, 502, 503, 504]),
    sleepFn: null,
    fetchFn: typeof fetch !== 'undefined' ? fetch : null,
    randomFn: Math.random
  });

  function defaultSleep(ms, signal) {
    if (signal?.aborted) {
      return Promise.reject(signal.reason || new DOMException('The operation was aborted.', 'AbortError'));
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason || new DOMException('The operation was aborted.', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function calculateBackoffDelay(attempt, config = {}) {
    const initial = Math.max(0, config.initialDelayMs ?? DEFAULT_BACKOFF_CONFIG.initialDelayMs);
    const maxDelay = Math.max(initial, config.maxDelayMs ?? DEFAULT_BACKOFF_CONFIG.maxDelayMs);
    const jitterRatio = Math.max(0, Math.min(1, config.jitterRatio ?? DEFAULT_BACKOFF_CONFIG.jitterRatio));
    const randomFn = config.randomFn ?? DEFAULT_BACKOFF_CONFIG.randomFn;

    const power = Math.min(Math.max(0, attempt), 30);
    const baseDelay = Math.min(maxDelay, initial * Math.pow(2, power));
    const randomFactor = (randomFn() * 2 - 1) * jitterRatio;
    return Math.max(0, Math.round(baseDelay * (1 + randomFactor)));
  }

  function isTransientStatus(status, retryOnStatus = DEFAULT_BACKOFF_CONFIG.retryOnStatus) {
    return Array.isArray(retryOnStatus) && retryOnStatus.includes(status);
  }

  function isTransientNetworkError(err) {
    if (!err) return false;
    if (err instanceof TypeError || err.name === 'TimeoutError' || err.name === 'AbortError') return true;
    if (typeof err.message === 'string') {
      const msg = err.message.toLowerCase();
      if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('fetch failed')) {
        return true;
      }
    }
    return false;
  }

  function getRetryAfterDelayMs(response, maxDelayMs) {
    const header = response?.headers?.get?.('Retry-After');
    if (!header) return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(maxDelayMs, Math.round(seconds * 1000));
    }
    const targetDateMs = Date.parse(header);
    if (Number.isFinite(targetDateMs)) {
      return Math.min(maxDelayMs, Math.max(0, targetDateMs - Date.now()));
    }
    return null;
  }

  async function fetchWithBackoff(url, options = {}, backoffConfig = {}) {
    const config = { ...DEFAULT_BACKOFF_CONFIG, ...backoffConfig };
    const fetchFn = config.fetchFn || globalThis.fetch;
    const sleepFn = config.sleepFn || ((ms) => defaultSleep(ms, options?.signal));

    if (typeof fetchFn !== 'function') {
      throw new Error('[Aura Network] No global fetch function available');
    }

    let attempt = 0;
    while (true) {
      if (attempt > 0 && options?.signal?.aborted) {
        throw options.signal.reason || new DOMException('The operation was aborted.', 'AbortError');
      }

      let response = null;
      let networkError = null;

      try {
        response = await fetchFn(url, options);
      } catch (err) {
        networkError = err;
      }

      if (networkError) {
        if (options?.signal?.aborted || networkError.name === 'AbortError') {
          throw networkError;
        }
        if (attempt >= config.maxRetries || !isTransientNetworkError(networkError)) {
          throw networkError;
        }

        const delayMs = calculateBackoffDelay(attempt, config);
        config.onRetry?.(attempt, delayMs, networkError);
        await sleepFn(delayMs);
        attempt++;
        continue;
      }

      if (response && isTransientStatus(response.status, config.retryOnStatus)) {
        if (attempt < config.maxRetries && !options?.signal?.aborted) {
          response.body?.cancel?.().catch(() => {});
          const retryAfterMs = getRetryAfterDelayMs(response, config.maxDelayMs);
          const delayMs = retryAfterMs ?? calculateBackoffDelay(attempt, config);
          config.onRetry?.(attempt, delayMs, response);
          await sleepFn(delayMs);
          attempt++;
          continue;
        }
        return response;
      }

      return response;
    }
  }

  return {
    DEFAULT_BACKOFF_CONFIG,
    calculateBackoffDelay,
    isTransientStatus,
    isTransientNetworkError,
    fetchWithBackoff
  };
});

