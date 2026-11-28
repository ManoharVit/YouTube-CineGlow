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

  const MAX_BACKOFF_EXPONENT = 30;

  function calculateBackoffDelay(attempt, config = {}) {
    const initial = Math.max(0, config.initialDelayMs ?? DEFAULT_BACKOFF_CONFIG.initialDelayMs);
    const maxDelay = Math.max(initial, config.maxDelayMs ?? DEFAULT_BACKOFF_CONFIG.maxDelayMs);
    const jitterRatio = Math.max(0, Math.min(1, config.jitterRatio ?? DEFAULT_BACKOFF_CONFIG.jitterRatio));
    const randomFn = config.randomFn ?? DEFAULT_BACKOFF_CONFIG.randomFn;

    const power = Math.min(Math.max(0, attempt), MAX_BACKOFF_EXPONENT);
    const baseDelay = Math.min(maxDelay, initial * Math.pow(2, power));
    const randomFactor = (randomFn() * 2 - 1) * jitterRatio;
    return Math.max(0, Math.round(baseDelay * (1 + randomFactor)));
  }

  function isTransientStatus(status, retryOnStatus = DEFAULT_BACKOFF_CONFIG.retryOnStatus) {
    return Array.isArray(retryOnStatus) && retryOnStatus.includes(status);
  }

  function isTransientNetworkError(err) {
    if (!err) return false;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
    if (err instanceof TypeError) {
      const msg = String(err.message || '').toLowerCase();
      return msg === '' || msg.includes('fetch') || msg.includes('network') || msg.includes('load') || msg.includes('connect') || msg.includes('timeout');
    }
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
    if (typeof header !== 'string' || header.trim() === '') return null;
    const trimmed = header.trim();
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(maxDelayMs, Math.round(seconds * 1000));
    }
    const targetDateMs = Date.parse(trimmed);
    if (Number.isFinite(targetDateMs)) {
      return Math.min(maxDelayMs, Math.max(0, targetDateMs - Date.now()));
    }
    return null;
  }

  async function fetchWithBackoff(url, options = {}, backoffConfig = {}) {
    const config = { ...DEFAULT_BACKOFF_CONFIG, ...backoffConfig };
    const rawMaxRetries = config.maxRetries ?? DEFAULT_BACKOFF_CONFIG.maxRetries;
    const maxRetries = Number.isFinite(Number(rawMaxRetries)) ? Math.max(0, Number(rawMaxRetries)) : DEFAULT_BACKOFF_CONFIG.maxRetries;
    const rawMaxDelay = config.maxDelayMs ?? DEFAULT_BACKOFF_CONFIG.maxDelayMs;
    const maxDelayMs = Number.isFinite(Number(rawMaxDelay)) ? Math.max(0, Number(rawMaxDelay)) : DEFAULT_BACKOFF_CONFIG.maxDelayMs;
    const normalizedConfig = { ...config, maxRetries, maxDelayMs };
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
        if (attempt >= maxRetries || !isTransientNetworkError(networkError)) {
          throw networkError;
        }

        const delayMs = calculateBackoffDelay(attempt, normalizedConfig);
        config.onRetry?.(attempt, delayMs, networkError);
        await sleepFn(delayMs, options?.signal);
        attempt++;
        continue;
      }

      if (response && isTransientStatus(response.status, config.retryOnStatus)) {
        if (attempt < maxRetries && !options?.signal?.aborted) {
          response.body?.cancel?.().catch(() => {});
          const retryAfterMs = getRetryAfterDelayMs(response, maxDelayMs);
          const delayMs = retryAfterMs ?? calculateBackoffDelay(attempt, normalizedConfig);
          config.onRetry?.(attempt, delayMs, response);
          await sleepFn(delayMs, options?.signal);
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

