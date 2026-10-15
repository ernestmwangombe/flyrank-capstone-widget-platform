// ==============================================================================
// File: src/middleware/validateIdempotencyKey.js
// Description: Reads and checks the optional Idempotency-Key header on the public submission endpoint.
// Analogy: the key is a ticket number the client writes on its request. If the same ticket number arrives twice
// (for example a retry after a lost reply), the server hands back the first result instead of doing the work again.
// ==============================================================================

// Allowed shape: 8 to 128 characters, only letters, digits and . _ : -  (a UUID or 32 hex characters fits)
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Express middleware. Puts the key on req.idempotencyKey (or null when the header was not sent).
 * A header that IS sent but has the wrong shape is a client mistake, so it gets a clean 400, never a 500.
 */
export function validateIdempotencyKey(req, res, next) {
  // Read the header (undefined when the client did not send it)
  const raw = req.get('idempotency-key');

  // No header: this request is not retry-protected, which is exactly how the endpoint behaved before
  if (raw === undefined) {
    // Remember "no key"
    req.idempotencyKey = null;
    // Continue to the next step
    return next();
  }

  // A header was sent: it must match the allowed shape
  if (!KEY_PATTERN.test(raw)) {
    // Reply 400 Bad Request in the standard validation error shape
    return res.status(400).json({
      error: 'Validation Failed',
      details: [{ field: 'Idempotency-Key', message: 'Idempotency-Key must be 8 to 128 characters: letters, digits and . _ : -' }]
    });
  }

  // Valid: keep the key for the handler
  req.idempotencyKey = raw;
  // Continue to the next step
  return next();
}
