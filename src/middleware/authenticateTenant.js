// ==============================================================================
// File: src/middleware/authenticateTenant.js
// Description: JWT authentication middleware shared by every owner-only (authenticated) route.
// Moved out of server.js unchanged so the widget routes and the dashboard routes use the SAME check.
// ==============================================================================

// Import the jsonwebtoken library used to verify signed tokens
import jwt from 'jsonwebtoken';

/**
 * Express middleware: only lets a request through if it carries a valid, unexpired JWT.
 * On success it stores the verified tenant id on req.tenantId; every owner query filters by that value.
 */
export const authenticateTenant = (req, res, next) => {
  // Read the Authorization header, or an empty string if it is absent
  const authHeader = req.headers['authorization'] || '';

  // Split "Bearer <token>" into its two parts
  const [scheme, token] = authHeader.split(' ');

  // Reject requests that do not use the Bearer scheme or have no token
  if (scheme !== 'Bearer' || !token) {
    // Reply 401 with a JSON error
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed Authorization header' });
  }

  try {
    // Verify the signature and expiry; the algorithms list blocks "alg: none" token tricks.
    // The secret is read here (at request time) so this file does not depend on when dotenv loaded.
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // Make sure the token actually carries a numeric tenant id
    if (!Number.isInteger(payload.tenant_id)) {
      // Reply 401 with a JSON error
      return res.status(401).json({ error: 'Unauthorized: Invalid token payload' });
    }

    // Store the verified tenant id on the request; every query below filters by it
    req.tenantId = payload.tenant_id;

    // Hand control to the next handler
    return next();
  } catch (err) {
    // Covers forged, tampered, malformed and expired tokens alike
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};
