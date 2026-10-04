// ==============================================================================
// File: src/middleware/rateLimiter.js
// Description: Token-bucket rate limiting per IP address and per widget (returns 429 under a flood)
// Analogy: each visitor has a bucket of tokens. Every request spends one token. Tokens drip back in
// steadily, so a quick burst empties the bucket (429), but a few seconds later the bucket has refilled.
// ==============================================================================

// Import the helper that works out the visitor's IP address
import { getClientIp } from '../utils/clientIp.js';

// Helper: read a positive number from an environment variable, or use the fallback when it is missing or invalid
function numberFromEnv(name, fallback) {
  // Convert the environment text to a number (NaN when it is missing or not a number)
  const value = Number(process.env[name]);
  // Use it only when it is a finite number above zero, otherwise use the fallback
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Builds a rate-limiting middleware backed by an in-memory token bucket.
 *   name            - label sent back in the 429 body ("ip" or "widget")
 *   capacity        - how many requests may arrive in one quick burst
 *   refillPerSecond - how many tokens drip back into an empty bucket each second
 *   keyFn           - function returning the bucket key for a request (return null to skip limiting)
 */
export function createTokenBucketLimiter({ name, capacity, refillPerSecond, keyFn }) {
  // Map of bucket key -> { tokens, updated }; this is the limiter's memory (it resets when the server restarts)
  const buckets = new Map();

  // Tries to spend one token from the bucket for this key and reports whether the request may continue
  function take(key, now) {
    // Look up this key's bucket
    let bucket = buckets.get(key);
    // First time we see this key: give it a full bucket
    if (!bucket) {
      // Create a full bucket stamped with the current time
      bucket = { tokens: capacity, updated: now };
      // Store it so later requests find it
      buckets.set(key, bucket);
    }
    // Seconds that passed since this bucket was last touched
    const elapsedSeconds = (now - bucket.updated) / 1000;
    // Add the tokens that dripped back in meanwhile, but never more than the bucket can hold
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
    // Remember when we last updated this bucket
    bucket.updated = now;

    // If at least one whole token is available, spend it and allow the request
    if (bucket.tokens >= 1) {
      // Spend one token
      bucket.tokens -= 1;
      // Tell the caller the request is allowed
      return { allowed: true, retryAfterSeconds: 0 };
    }
    // Otherwise work out how many seconds until one token has dripped back in (rounded up, at least 1)
    const retryAfterSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSecond));
    // Tell the caller the request is blocked and when to try again
    return { allowed: false, retryAfterSeconds };
  }

  // Housekeeping: every minute delete buckets that have been idle long enough to be full again, so memory cannot grow forever
  const cleanupTimer = setInterval(() => {
    // Current time in milliseconds
    const now = Date.now();
    // Idle time (in milliseconds) after which a bucket would be completely full again
    const fullAfterMs = (capacity / refillPerSecond) * 1000;
    // Check every stored bucket
    for (const [key, bucket] of buckets) {
      // Delete the bucket if it has been idle longer than the refill time
      if (now - bucket.updated > fullAfterMs) {
        // Remove the idle bucket
        buckets.delete(key);
      }
    }
  }, 60000);
  // unref() lets Node exit normally even though this timer is still scheduled
  cleanupTimer.unref();

  // The Express middleware itself
  return function rateLimit(req, res, next) {
    // CORS preflight requests (OPTIONS) are never counted, otherwise real browsers would burn two tokens per submission
    if (req.method === 'OPTIONS') {
      // Skip limiting for preflights
      return next();
    }
    // Work out which bucket this request belongs to
    const key = keyFn(req);
    // If there is no key (for example no widget id yet), do not limit here
    if (!key) {
      // Continue to the next middleware
      return next();
    }
    // Try to spend a token
    const result = take(key, Date.now());
    // Allowed: continue to the next middleware
    if (result.allowed) {
      // Hand over to the next step
      return next();
    }
    // Blocked: tell the client how long to wait using the standard Retry-After header
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    // Log the block as one JSON line (no personal data: only the scope name)
    console.warn(JSON.stringify({ event: 'rate_limited', scope: name }));
    // Reply 429 Too Many Requests with a clean JSON body
    return res.status(429).json({
      error: 'Too many requests',
      scope: name,
      retry_after_seconds: result.retryAfterSeconds
    });
  };
}

// Limiter 1: per visitor IP. Default: bursts of 10, refilling 2 tokens per second (override with the RATE_LIMIT_IP_* variables)
export const ipRateLimiter = createTokenBucketLimiter({
  // Label used in the 429 body
  name: 'ip',
  // Burst size
  capacity: numberFromEnv('RATE_LIMIT_IP_BURST', 10),
  // Refill speed in tokens per second
  refillPerSecond: numberFromEnv('RATE_LIMIT_IP_REFILL_PER_SEC', 2),
  // The bucket key is the visitor's IP address (empty text becomes null so it is not limited)
  keyFn: (req) => getClientIp(req) || null
});

// Limiter 2: per widget, shared by all visitors. Default: bursts of 30, refilling 5 tokens per second (RATE_LIMIT_WIDGET_* variables)
export const widgetRateLimiter = createTokenBucketLimiter({
  // Label used in the 429 body
  name: 'widget',
  // Burst size
  capacity: numberFromEnv('RATE_LIMIT_WIDGET_BURST', 30),
  // Refill speed in tokens per second
  refillPerSecond: numberFromEnv('RATE_LIMIT_WIDGET_REFILL_PER_SEC', 5),
  // The bucket key is the widget id found by the validator (null when validation has not run)
  keyFn: (req) => (req.validatedData && req.validatedData.widget_id ? `widget:${req.validatedData.widget_id}` : null)
});
