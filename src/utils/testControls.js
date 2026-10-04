// ==============================================================================
// File: src/utils/testControls.js
// Description: Development-only switches that let a test make a geo provider or the email "fail on purpose"
// ==============================================================================

/**
 * Reads the test-control headers from a request.
 * They only work when TEST_CONTROLS=true, so in production they are ignored and every request behaves normally.
 *   X-Test-Geo-Down: a        -> geo provider A answers "down" for this request
 *   X-Test-Geo-Down: a,b      -> both geo providers answer "down" for this request
 *   X-Test-Notify-Fail: true  -> the confirmation email throws an error for this request
 */
export function readTestControls(req) {
  // Start with "nothing is forced to fail"
  const controls = { geoDown: new Set(), notifyFail: false };

  // When test controls are off, return the harmless defaults straight away
  if (process.env.TEST_CONTROLS !== 'true') {
    return controls;
  }

  // Read the list of providers to switch off (empty text when the header is missing)
  const downHeader = req.get('x-test-geo-down') || '';
  // Look at each comma-separated name, for example "a" and "b"
  for (const rawName of downHeader.split(',')) {
    // Clean the name: remove spaces and make it lower case
    const name = rawName.trim().toLowerCase();
    // Remember it only if something is left after cleaning
    if (name) {
      // Add the provider key to the set of providers that must act as "down"
      controls.geoDown.add(name);
    }
  }

  // The email failure switch is on only when the header says exactly "true"
  controls.notifyFail = (req.get('x-test-notify-fail') || '').trim().toLowerCase() === 'true';

  // Hand the finished switches back to the caller
  return controls;
}
