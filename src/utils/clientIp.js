// ==============================================================================
// File: src/utils/clientIp.js
// Description: Works out which IP address a request came from
// ==============================================================================

// Import Node's built-in net module, used here to check that a string really is an IP address
import net from 'node:net';

/**
 * Returns the visitor's IP address as the server sees it.
 * When TEST_CONTROLS=true (development only) a request may claim another address with the
 * X-Test-Client-Ip header, so one laptop can pretend to be many different visitors.
 */
export function getClientIp(req) {
  // Only honour the test override when test controls are switched on (they are off by default and must stay off in production)
  if (process.env.TEST_CONTROLS === 'true') {
    // Read the override header (undefined when the header was not sent)
    const override = req.get('x-test-client-ip');
    // Accept the override only if it is a syntactically valid IPv4 or IPv6 address
    if (override && net.isIP(override.trim()) !== 0) {
      // Use the cleaned override address
      return override.trim();
    }
  }
  // Normal case: the address of the connection (req.ip), falling back to the raw socket address, then to an empty string
  return req.ip || (req.socket && req.socket.remoteAddress) || '';
}
