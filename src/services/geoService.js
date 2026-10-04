// ==============================================================================
// File: src/services/geoService.js
// Description: IP -> location lookup with a fallback chain (provider A, then provider B, then "store without geo")
// Analogy: ask the first taxi company; if nobody answers, ring the second; if both are busy, walk. The trip still happens.
// ==============================================================================

// Import Node's built-in net module, used to recognise valid and private IP addresses
import net from 'node:net';

// Helper: read the mode from the environment each time ("mock" = built-in fake providers, anything else = the real free APIs)
function getMode() {
  // Default to the real providers when GEO_MODE is not set
  return (process.env.GEO_MODE || 'real').toLowerCase();
}

// Helper: how many milliseconds one provider may take before we give up on it (default 1500)
function getTimeoutMs() {
  // Convert the environment text to a number
  const value = Number(process.env.GEO_TIMEOUT_MS);
  // Use it only when it is a number above zero, otherwise 1500
  return Number.isFinite(value) && value > 0 ? value : 1500;
}

// Helper: true when an address is private, local, reserved or not an IP at all (public geo services cannot locate these)
function isPrivateOrReserved(ip) {
  // Start with the address as given
  let address = ip || '';
  // IPv4 addresses are often reported as IPv6-mapped text such as ::ffff:172.18.0.1, so strip that prefix
  if (address.toLowerCase().startsWith('::ffff:') && net.isIP(address.slice(7)) === 4) {
    // Keep only the IPv4 part
    address = address.slice(7);
  }
  // Find out what kind of address this is: 4, 6, or 0 when it is not an IP
  const version = net.isIP(address);
  // Not an IP at all: unusable
  if (version === 0) return true;
  // IPv4 checks
  if (version === 4) {
    // Split "a.b.c.d" and keep the first two numbers
    const [a, b] = address.split('.').map(Number);
    // 0.x, 10.x, 127.x (loopback), 169.254.x (link-local), 172.16-31.x, 192.168.x, 100.64-127.x (carrier NAT), 224+ (multicast/reserved)
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  // IPv6 checks: compare against the lower-case text
  const lower = address.toLowerCase();
  // ::1 (loopback), :: (unspecified), fc00::/7 (unique local), fe80::/10 (link-local)
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') ||
    lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
}

// Helper: GET a URL and parse the JSON reply, failing on timeouts and on non-2xx statuses
async function fetchJson(url, timeoutMs) {
  // AbortSignal.timeout cancels the request after timeoutMs milliseconds
  const response = await fetch(url, {
    // Cancel the request when the time limit is reached
    signal: AbortSignal.timeout(timeoutMs),
    // Ask for JSON and identify ourselves politely
    headers: { accept: 'application/json', 'user-agent': 'flyrank-capstone-widget-platform' }
  });
  // Treat any non-2xx status (for example 429 when a free tier is used up) as a failure
  if (!response.ok) {
    // Throw so the caller moves on to the next provider
    throw new Error(`HTTP ${response.status}`);
  }
  // Parse and return the JSON body
  return response.json();
}

// Helper: make every provider return the same shape, and reject answers that contain no country
function normalize(raw) {
  // A usable answer must at least name a country
  if (!raw.country || typeof raw.country !== 'string') {
    // Throw so the caller moves on to the next provider
    throw new Error('provider answered without a country');
  }
  // Return only the fields we store, using null for anything missing
  return {
    country: raw.country,
    country_code: raw.country_code || null,
    region: raw.region || null,
    city: raw.city || null
  };
}

// Real provider A: ip-api.com (free, no key; the free tier only supports plain http)
const realProviderA = {
  // Name stored with the result so we can see which provider answered
  name: 'ip-api.com',
  // Look up one IP address
  async lookup(ip, timeoutMs) {
    // Base URL can be overridden with GEO_PROVIDER_A_URL (used to point the code at a local fake server in tests)
    const base = process.env.GEO_PROVIDER_A_URL || 'http://ip-api.com/json';
    // Ask only for the fields we need
    const data = await fetchJson(`${base}/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city`, timeoutMs);
    // ip-api reports failures inside a 200 reply as status "fail"
    if (data.status !== 'success') {
      // Throw with the provider's own message
      throw new Error(data.message || 'lookup failed');
    }
    // Convert to our common shape
    return normalize({ country: data.country, country_code: data.countryCode, region: data.regionName, city: data.city });
  }
};

// Real provider B: ipapi.co (free tier, around 1000 lookups per day, no key)
const realProviderB = {
  // Name stored with the result
  name: 'ipapi.co',
  // Look up one IP address
  async lookup(ip, timeoutMs) {
    // Base URL can be overridden with GEO_PROVIDER_B_URL
    const base = process.env.GEO_PROVIDER_B_URL || 'https://ipapi.co';
    // ipapi.co puts the address in the path
    const data = await fetchJson(`${base}/${encodeURIComponent(ip)}/json/`, timeoutMs);
    // ipapi.co reports failures inside a 200 reply with error: true
    if (data.error) {
      // Throw with the provider's own reason
      throw new Error(data.reason || 'lookup failed');
    }
    // Convert to our common shape
    return normalize({ country: data.country_name, country_code: data.country_code, region: data.region, city: data.city });
  }
};

// Builds a deterministic fake provider for tests. "key" is the letter used in the X-Test-Geo-Down header.
function makeMockProvider(key, country, countryCode, city) {
  // Return a provider object with the same interface as the real ones
  return {
    // Name stored with the result, for example "mock-a"
    name: `mock-${key}`,
    // Look up one IP address (the address is ignored: the answer is always the same)
    async lookup(ip, timeoutMs, controls) {
      // When the test asked for this provider to be down, fail like a real outage would
      if (controls && controls.geoDown && controls.geoDown.has(key)) {
        // Throw so the chain moves on
        throw new Error(`mock provider ${key} is switched down`);
      }
      // Otherwise answer with fixed, recognisable data
      return { country, country_code: countryCode, region: null, city };
    }
  };
}

// The two mock providers, answering with different countries so a test can tell which one replied
const mockProviderA = makeMockProvider('a', 'Mockland A', 'MA', 'Alpha City');
const mockProviderB = makeMockProvider('b', 'Mockland B', 'MB', 'Beta City');

/**
 * Looks up the visitor's location. NEVER throws and never blocks the submission:
 *   { status: 'enriched',    geo: { country, ..., provider } }  - a provider answered
 *   { status: 'unavailable', geo: null }                         - every provider failed
 *   { status: 'skipped',     geo: null }                         - private/unknown address, nothing to look up
 */
export async function enrichIp(ip, controls) {
  try {
    // Which mode are we in?
    const mock = getMode() === 'mock';
    // In real mode, private and local addresses cannot be located, so do not waste calls on them
    if (!mock && isPrivateOrReserved(ip)) {
      // Report that enrichment was skipped
      return { status: 'skipped', geo: null };
    }
    // The ordered fallback chain: A first, then B
    const chain = mock ? [mockProviderA, mockProviderB] : [realProviderA, realProviderB];
    // Time limit for each provider
    const timeoutMs = getTimeoutMs();
    // Try the providers one after another
    for (const provider of chain) {
      try {
        // Ask this provider
        const geo = await provider.lookup(ip, timeoutMs, controls);
        // Success: return the answer, tagged with the provider that gave it
        return { status: 'enriched', geo: { ...geo, provider: provider.name } };
      } catch (err) {
        // Failure: log it as one JSON line (no IP address in the log) and fall through to the next provider
        console.warn(JSON.stringify({ event: 'geo_provider_failed', provider: provider.name, error: err.message }));
      }
    }
    // Every provider failed: the caller stores the submission without geo data
    return { status: 'unavailable', geo: null };
  } catch (err) {
    // Safety net: even an unexpected bug here must not break the submission
    console.error(JSON.stringify({ event: 'geo_unexpected_error', error: err.message }));
    // Report "unavailable" so the submission continues
    return { status: 'unavailable', geo: null };
  }
}
