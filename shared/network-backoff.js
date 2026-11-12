// shared/network-backoff.js
// CineGlow Pro for YouTube - Milestone M1 Exponential Backoff Utility
// Author: Giri Manohar Vemula (https://www.linkedin.com/in/manoharv511)

(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    const exports = factory();
    Object.assign(root, exports);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_BACKOFF_CONFIG = Object.freeze({
    initialDelayMs: 1000,
    maxDelayMs: 16000,
    maxRetries: 3,
    jitterRatio: 0.2,
    retryOnStatus: Object.freeze([502, 503, 504]),
    sleepFn: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fetchFn: typeof fetch !== 'undefined' ? fetch : null,
    randomFn: Math.random
  });

  /**
   * Calculates backoff delay according to:
   * $$t = \min(t_{\max}, t_0 \cdot 2^n) \pm \text{jitter}$$
   *
   * @param {number} attempt - Zero-based retry index (0 for first retry)
   * @param {object} [config] - Backoff parameters
   * @returns {number} Delay in milliseconds
   */
  function calculateBackoffDelay(attempt, config = {}) {
    const initial = Math.max(0, config.initialDelayMs ?? DEFAULT_BACKOFF_CONFIG.initialDelayMs);
    const maxDelay = Math.max(initial, config.maxDelayMs ?? DEFAULT_BACKOFF_CONFIG.maxDelayMs);
    const jitterRatio = Math.max(0, Math.min(1, config.jitterRatio ?? DEFAULT_BACKOFF_CONFIG.jitterRatio));
    const randomFn = config.randomFn ?? DEFAULT_BACKOFF_CONFIG.randomFn;

    const power = Math.min(Math.max(0, attempt), 30);
    const baseDelay = Math.min(maxDelay, initial * Math.pow(2, power));

    // Jitter: +/- (jitterRatio * 100)%
    const randomFactor = (randomFn() * 2 - 1) * jitterRatio;
    const delayWithJitter = baseDelay * (1 + randomFactor);

    return Math.max(0, Math.round(delayWithJitter));
  }

  /**
   * Determines if an HTTP status represents a transient server outage.
   */
  function isTransientStatus(status, retryOnStatus = DEFAULT_BACKOFF_CONFIG.retryOnStatus) {
    return Array.isArray(retryOnStatus) && retryOnStatus.includes(status);
  }

  /**
   * Determines if a thrown error represents a transient network/connection failure.
   */
  function isTransientNetworkError(err) {
    if (!err) return false;
    if (err instanceof TypeError) return true;
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
    if (typeof err.message === 'string') {
      const msg = err.message.toLowerCase();
      if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('fetch failed')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Executes fetch with exponential backoff and jitter on transient server outages (502, 503, 504)
   * or transport-level network errors.
   *
   * @param {string|Request} url - Target URL or Request object
   * @param {RequestInit} [options] - Standard fetch options
   * @param {object} [backoffConfig] - Backoff configuration overrides
   * @returns {Promise<Response>} Resolves with the Response or throws after retries exhausted
   */
  async function fetchWithBackoff(url, options = {}, backoffConfig = {}) {
    const config = { ...DEFAULT_BACKOFF_CONFIG, ...backoffConfig };
    const fetchFn = config.fetchFn || globalThis.fetch;

    if (typeof fetchFn !== 'function') {
      throw new Error('[Aura Network] No global fetch function available');
    }

    let attempt = 0;
    while (true) {
      let response = null;
      let networkError = null;

      try {
        response = await fetchFn(url, options);
      } catch (err) {
        networkError = err;
      }

      // Check for transient network error (e.g. TypeError: Failed to fetch)
      if (networkError) {
        const canRetry = attempt < config.maxRetries && isTransientNetworkError(networkError);
        if (!canRetry) {
          throw networkError;
        }

        const delayMs = calculateBackoffDelay(attempt, config);
        if (typeof config.onRetry === 'function') {
          config.onRetry(attempt, delayMs, networkError);
        }
        await config.sleepFn(delayMs);
        attempt++;
        continue;
      }

      // Check for transient HTTP status (502, 503, 504)
      if (response && isTransientStatus(response.status, config.retryOnStatus)) {
        if (attempt < config.maxRetries) {
          const delayMs = calculateBackoffDelay(attempt, config);
          if (typeof config.onRetry === 'function') {
            config.onRetry(attempt, delayMs, response);
          }
          await config.sleepFn(delayMs);
          attempt++;
          continue;
        }
        // Retries exhausted: return the final response (allowing caller to read status cleanly)
        return response;
      }

      // Success (2xx) or permanent non-transient status (4xx, 3xx, 500, etc.)
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
