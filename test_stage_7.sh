#!/bin/bash
# ==============================================================================
# FlyRank Capstone - Stage 7 Test Suite: Second-Origin Customer Site, Widget Form & CORS
# Needs: bash, curl and jq, with the whole system running (docker compose up: API on 3000, customer test site on 5500)
# and TEST_CONTROLS=true, GEO_MODE=mock (same settings as Stages 5 and 6).
# These checks use curl to send exactly what a browser on the second origin sends (Origin header, preflight, JSON body).
# A real browser check is described in the README ("Customer test site").
# ==============================================================================

# Base URL of the API (origin 1)
BASE_URL="http://localhost:3000"
# Base URL of the customer test site (origin 2: same host, different port, so the browser treats it as another origin)
SITE_URL="http://localhost:5500"
# The public submission endpoint
SUBMIT_URL="$BASE_URL/api/embed/submit"
# Counter of passed checks
PASSED=0
# Counter of failed checks
FAILED=0
# A private temporary folder for response headers and bodies
TMP_DIR=$(mktemp -d)
# Delete the temporary folder when the script ends, however it ends
trap 'rm -rf "$TMP_DIR"' EXIT

# Records a passed check and prints it
pass() {
  # Print the check with a green tick
  echo "  ✅ PASS: $1"
  # Increase the pass counter
  PASSED=$((PASSED + 1))
}

# Records a failed check and prints it
fail() {
  # Print the check with a red cross
  echo "  ❌ FAIL: $1"
  # Increase the fail counter
  FAILED=$((FAILED + 1))
}

# Compares an expected value with the actual one: expect_equal "description" "expected" "actual"
expect_equal() {
  # Same text means the check passed
  if [ "$2" = "$3" ]; then
    # Report success including the value
    pass "$1 (Value: $3)"
  else
    # Report failure including both values
    fail "$1 (Expected: '$2', Got: '$3')"
  fi
}

# Passes when the text contains a fragment (case-insensitive): expect_contains "description" "fragment" "text"
# Short texts (such as a header value) are printed in full; long texts (a whole page or script) are NOT dumped, only the fragment that was found
expect_contains() {
  # Lower-case both sides, then search for the fragment
  if echo "$3" | tr 'A-Z' 'a-z' | grep -q -F "$(echo "$2" | tr 'A-Z' 'a-z')"; then
    # Short text: report the whole value
    if [ "${#3}" -le 80 ]; then
      # Report success including the value
      pass "$1 (Value: $3)"
    else
      # Long text: report only the fragment that was found
      pass "$1 (found: '$2')"
    fi
  else
    # Report failure with at most the first 200 characters of what was received, on one line
    fail "$1 (Expected to contain: '$2', Got: '$(echo "$3" | head -c 200 | tr '\n' ' ')')"
  fi
}

# Prints one response header value from a saved header file: header_value <file> <header-name>
header_value() {
  # Find the header line (case-insensitive), keep the last one, drop the name, and remove the carriage return
  grep -i "^$2:" "$1" | tail -1 | cut -d' ' -f2- | tr -d '\r'
}

# Sends a request and saves headers and body in the temp folder; prints the HTTP status code
# Usage: send <curl arguments...>   (headers go to $TMP_DIR/headers, body to $TMP_DIR/body)
send() {
  # -D saves the response headers, -o the body, -w prints the status
  curl -s -D "$TMP_DIR/headers" -o "$TMP_DIR/body" -w '%{http_code}' "$@"
}

echo "=========================================================="
echo " Starting Stage 7: Second-Origin Customer Site, Widget Form & CORS"
echo " API origin:      $BASE_URL"
echo " Customer origin: $SITE_URL"
echo "=========================================================="

# ------------------------------------------------------------------------------
# SETUP AND PRE-FLIGHT: everything below depends on these
# ------------------------------------------------------------------------------
echo ""
echo "[Setup] Checking the customer site, the demo owner login and the bundle version..."

# The customer test site must answer on its own port
SITE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/")
# Stop with a clear explanation if it does not
if [ "$SITE_STATUS" != "200" ]; then
  # Explain what is missing
  echo "  ❌ FAIL: the customer test site is not reachable at $SITE_URL (status $SITE_STATUS)."
  # Tell the user the fix
  echo "     Start everything with: docker compose up --build   (the customer_site service serves it on port 5500)"
  # Stop the whole script
  exit 1
fi
# Report that the site answers
echo "  customer test site answers on $SITE_URL"

# Log in as the seeded demo owner (created by schema.sql)
DEMO_TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"dev@flyrank.ai","password":"DemoPass123!"}' | jq -r '.token')
# Stop with a clear explanation if the demo owner cannot log in
if [ -z "$DEMO_TOKEN" ] || [ "$DEMO_TOKEN" = "null" ]; then
  # Explain what is wrong
  echo "  ❌ FAIL: the demo owner dev@flyrank.ai cannot log in. The database was seeded before Stage 7."
  # Tell the user the fix
  echo "     Re-seed: docker compose exec -T postgres psql -U postgres -d flyrank_db < schema.sql"
  # Stop the whole script
  exit 1
fi
# Report that the login works
echo "  demo owner login OK"

# Create a widget as the demo owner and read its embed snippet, to learn which bundle version new embeds use
SNIPPET=$(curl -s -X POST "$BASE_URL/api/widgets" -H "Authorization: Bearer $DEMO_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Stage 7 check widget","type":"signup_form","config":{"title":"Stage 7"}}' | jq -r '.embed_snippet')
# New snippets must point at version 2
if ! echo "$SNIPPET" | grep -q 'widget\.v2\.js'; then
  # Explain what is wrong
  echo "  ❌ FAIL: new embed snippets do not use widget.v2.js (snippet: $SNIPPET)."
  # Tell the user the fix
  echo "     Your .env probably still says WIDGET_VERSION=1. Change it to WIDGET_VERSION=2 (or delete the line) and restart."
  # Stop the whole script
  exit 1
fi
# Report the snippet
echo "  new embed snippets use version 2: $SNIPPET"

# ------------------------------------------------------------------------------
# TEST SUITE 1: the customer site is a different origin and embeds the widget
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 1] The customer test site is a separate origin..."

# Fetch the customer page and keep its headers
PAGE_STATUS=$(send "$SITE_URL/")
# The page is served successfully
expect_equal "customer page returns 200" "200" "$PAGE_STATUS"
# It is an HTML page
expect_contains "customer page is HTML" "text/html" "$(header_value "$TMP_DIR/headers" content-type)"
# It loads the widget from the API's address, not from its own
expect_contains "customer page embeds the API-hosted widget.v2.js bundle" "http://localhost:3000" "$(cat "$TMP_DIR/body")"
# The bundle name appears too
expect_contains "customer page uses widget.v2.js" "widget.v2.js" "$(cat "$TMP_DIR/body")"
# The two origins (scheme + host + port) are different
if [ "$SITE_URL" != "$BASE_URL" ]; then pass "page origin ($SITE_URL) differs from API origin ($BASE_URL)"; else fail "page and API share an origin"; fi
# The API itself does not serve that page: its root is a JSON 404
ROOT_STATUS=$(send "$BASE_URL/")
# 404 from the API
expect_equal "the API does not serve the page itself (GET / is 404)" "404" "$ROOT_STATUS"
# And the answer is JSON
expect_contains "API 404 is JSON" "application/json" "$(header_value "$TMP_DIR/headers" content-type)"

# ------------------------------------------------------------------------------
# TEST SUITE 2: the widget bundle (version 2) and old versions
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 2] Widget bundle: versioned, cacheable, small and safe..."

# Download version 2 with an Origin header, as a browser on the customer site would
V2_STATUS=$(send "$BASE_URL/widget.v2.js?id=1" -H "Origin: $SITE_URL")
# Served
expect_equal "GET /widget.v2.js returns 200" "200" "$V2_STATUS"
# JavaScript content type
expect_contains "content type is JavaScript" "application/javascript" "$(header_value "$TMP_DIR/headers" content-type)"
# Cached for a year, immutable
expect_equal "long-term cache header" "public, max-age=31536000, immutable" "$(header_value "$TMP_DIR/headers" cache-control)"
# Readable from any origin
expect_equal "Access-Control-Allow-Origin on the bundle" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"
# Keep a copy of the body for the content checks
cp "$TMP_DIR/body" "$TMP_DIR/v2.js"
# Size in bytes (small payloads matter for widget load time)
V2_SIZE=$(wc -c < "$TMP_DIR/v2.js" | tr -d ' ')
# Under 10 KB uncompressed
if [ "$V2_SIZE" -le 10240 ]; then pass "bundle is small ($V2_SIZE bytes, limit 10240)"; else fail "bundle is too large ($V2_SIZE bytes, limit 10240)"; fi
# No comment-only lines are shipped to browsers
expect_equal "no comment lines shipped in the public bundle" "0" "$(grep -c '^//' "$TMP_DIR/v2.js")"
# No blank lines either
expect_equal "no blank lines shipped in the public bundle" "0" "$(grep -c '^$' "$TMP_DIR/v2.js")"
# It submits to the public endpoint
expect_contains "bundle posts to the submission endpoint" "/api/embed/submit" "$(cat "$TMP_DIR/v2.js")"
# It includes the honeypot field name
expect_contains "bundle includes the honeypot field" "'website'" "$(cat "$TMP_DIR/v2.js")"
# It reports results to the host page
expect_contains "bundle announces results to the host page" "flyrank:submit-result" "$(cat "$TMP_DIR/v2.js")"
# It shows owner-supplied text as plain text
expect_contains "bundle sets text with textContent" "textContent" "$(cat "$TMP_DIR/v2.js")"
# It never assigns HTML
if grep -q 'innerHTML' "$TMP_DIR/v2.js"; then fail "bundle uses innerHTML"; else pass "bundle does not use innerHTML"; fi

# Version 1 must still be served (old embeds keep working) and must be a different file from version 2
V1_STATUS=$(send "$BASE_URL/widget.v1.js?id=1")
# Still served
expect_equal "old version 1 is still served" "200" "$V1_STATUS"
# Still cacheable forever
expect_equal "version 1 keeps its immutable cache header" "public, max-age=31536000, immutable" "$(header_value "$TMP_DIR/headers" cache-control)"
# The two versions differ
if cmp -s "$TMP_DIR/body" "$TMP_DIR/v2.js"; then fail "version 1 and version 2 are identical"; else pass "version 1 and version 2 are different files"; fi
# The unversioned URL tracks the current version, with a short cache
LEGACY_STATUS=$(send "$BASE_URL/widget.js?id=1")
# Served
expect_equal "unversioned /widget.js returns 200" "200" "$LEGACY_STATUS"
# Short cache
expect_equal "unversioned /widget.js has a short cache" "public, max-age=60" "$(header_value "$TMP_DIR/headers" cache-control)"
# It is the current version (same bytes as version 2)
if cmp -s "$TMP_DIR/body" "$TMP_DIR/v2.js"; then pass "unversioned /widget.js serves the current version (same bytes as v2)"; else fail "unversioned /widget.js does not match version 2"; fi

# ------------------------------------------------------------------------------
# TEST SUITE 3: CORS, exactly as a browser on the customer site needs it
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 3] CORS: preflight and responses for a request from $SITE_URL..."

# The widget downloads its config with a simple cross-origin GET
CONFIG_STATUS=$(send "$BASE_URL/api/widgets/1/config" -H "Origin: $SITE_URL")
# Served
expect_equal "config GET from the customer origin returns 200" "200" "$CONFIG_STATUS"
# Readable cross-origin
expect_equal "config response allows the customer origin" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"

# A JSON POST is not a "simple" request, so the browser first sends an OPTIONS preflight with these headers
PRE_STATUS=$(send -X OPTIONS "$SUBMIT_URL" -H "Origin: $SITE_URL" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type')
# The preflight must succeed with no body
expect_equal "preflight (OPTIONS) returns 204" "204" "$PRE_STATUS"
# It must allow the origin
expect_equal "preflight allows the customer origin" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"
# It must allow the POST method
expect_contains "preflight allows POST" "POST" "$(header_value "$TMP_DIR/headers" access-control-allow-methods)"
# It must allow the Content-Type header
expect_contains "preflight allows the Content-Type header" "content-type" "$(header_value "$TMP_DIR/headers" access-control-allow-headers)"
# It tells the browser it may remember the answer (fewer preflights)
expect_equal "preflight can be cached by the browser (max-age 600)" "600" "$(header_value "$TMP_DIR/headers" access-control-max-age)"

# The real POST, with the headers a browser adds on the second origin
POST_STATUS=$(send -X POST "$SUBMIT_URL" -H "Origin: $SITE_URL" -H "Referer: $SITE_URL/?widget=1" -H 'Content-Type: application/json' -H 'x-test-client-ip: 198.51.100.121' \
  -d '{"widget_id":1,"data":{"name":"CORS check"},"metadata":{"page_url":"http://localhost:5500/?widget=1"}}')
# Stored
expect_equal "cross-origin POST is accepted" "201" "$POST_STATUS"
# The browser may only let the page read the answer when this header is present
expect_equal "cross-origin POST response is readable by the page" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"

# Error responses must be readable too, otherwise the widget could not show messages like "please check your answers"
E400=$(send -X POST "$SUBMIT_URL" -H "Origin: $SITE_URL" -H 'Content-Type: application/json' -H 'x-test-client-ip: 198.51.100.122' -d '{"widget_id":1}')
# Validation error
expect_equal "validation error (400) status" "400" "$E400"
# Readable
expect_equal "validation error is readable by the page" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"
# Unknown widget
E404=$(send -X POST "$SUBMIT_URL" -H "Origin: $SITE_URL" -H 'Content-Type: application/json' -H 'x-test-client-ip: 198.51.100.123' -d '{"widget_id":99999999,"data":{"a":"b"}}')
# Not found
expect_equal "unknown widget (404) status" "404" "$E404"
# Readable
expect_equal "404 is readable by the page" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"
# Malformed JSON
EBAD=$(send -X POST "$SUBMIT_URL" -H "Origin: $SITE_URL" -H 'Content-Type: application/json' -H 'x-test-client-ip: 198.51.100.124' -d '{bad json')
# Bad request
expect_equal "malformed JSON (400) status" "400" "$EBAD"
# Readable
expect_equal "malformed JSON error is readable by the page" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"

# Rate-limit responses must be readable as well, and expose Retry-After: first drain one visitor's bucket with a parallel burst
seq 1 30 | xargs -P 30 -I @@ curl -s -o /dev/null -X POST "$SUBMIT_URL" -H 'Content-Type: application/json' -H 'x-test-client-ip: 198.51.100.131' \
  -d '{"widget_id":1,"data":{"note":"cors burst"}}'
# Then keep sending single requests until one is rate limited (a bucket refills slowly, so this happens within a few tries)
GOT_429="no"
# Try up to 20 times
for attempt in $(seq 1 20); do
  # One more request from the same visitor
  CODE=$(send -X POST "$SUBMIT_URL" -H "Origin: $SITE_URL" -H 'Content-Type: application/json' -H 'x-test-client-ip: 198.51.100.131' -d '{"widget_id":1,"data":{"note":"cors burst"}}')
  # Stop at the first 429, keeping its headers and body
  if [ "$CODE" = "429" ]; then GOT_429="yes"; break; fi
done
# We must have seen a 429
expect_equal "a flood from one visitor gets 429" "yes" "$GOT_429"
# The 429 must be readable by the page
expect_equal "429 is readable by the page" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"
# It tells the page how long to wait
if [ -n "$(header_value "$TMP_DIR/headers" retry-after)" ]; then pass "429 carries a Retry-After header ($(header_value "$TMP_DIR/headers" retry-after) s)"; else fail "429 has no Retry-After header"; fi
# The browser may read Retry-After only if the server exposes it
expect_contains "Retry-After is exposed to browser code" "retry-after" "$(header_value "$TMP_DIR/headers" access-control-expose-headers)"

# ------------------------------------------------------------------------------
# TEST SUITE 4: Probe 1 flow - a submission from the second origin shows up in the owner's dashboard
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 4] A submission from the customer page becomes visible in the dashboard..."

# What the page's form is built from: the widget's public config
CONFIG=$(curl -s "$BASE_URL/api/widgets/1/config")
# At least two fields are configured, so the page shows a real form
expect_equal "widget 1 config defines 3 form fields" "3" "$(echo "$CONFIG" | jq '.config.fields | length')"
# The email field is required
expect_equal "the email field is required" "true" "$(echo "$CONFIG" | jq '[.config.fields[] | select(.name=="email")][0].required')"
# A title for the card
expect_equal "widget 1 config has a title" "Stay in touch" "$(echo "$CONFIG" | jq -r '.config.title')"

# Count the demo owner's submissions on widget 1 before the test
TOTAL_BEFORE=$(curl -s "$BASE_URL/api/dashboard/submissions?widget_id=1&limit=1" -H "Authorization: Bearer $DEMO_TOKEN" | jq -r '.pagination.total')
# Submit exactly as the widget does: JSON body with the visitor's answers, the empty honeypot and the page address
RESP=$(curl -s -w '|%{http_code}' -X POST "$SUBMIT_URL" -H "Origin: $SITE_URL" -H "Referer: $SITE_URL/?widget=1" -H 'Content-Type: application/json' -H 'x-test-client-ip: 198.51.100.141' \
  -d '{"widget_id":1,"data":{"name":"Grace Hopper","email":"grace@example.com","feedback":"Hello from the customer site","website":""},"metadata":{"page_url":"http://localhost:5500/?widget=1"}}')
# Split the status and the body
CODE="${RESP##*|}"
# The body
BODY="${RESP%|*}"
# Stored
expect_equal "visitor submission from the customer origin is accepted" "201" "$CODE"
# Its id
NEW_ID=$(echo "$BODY" | jq -r '.submission_id')
# The dashboard shows it
DASH=$(curl -s "$BASE_URL/api/dashboard/submissions?widget_id=1&limit=1" -H "Authorization: Bearer $DEMO_TOKEN")
# It is the newest item
expect_equal "it is the newest item in the owner's dashboard" "$NEW_ID" "$(echo "$DASH" | jq -r '.data[0].id')"
# The total grew by one
expect_equal "the dashboard total grew by one" "$((TOTAL_BEFORE + 1))" "$(echo "$DASH" | jq -r '.pagination.total')"
# The answers are stored
expect_equal "the visitor's answers are stored" "Hello from the customer site" "$(echo "$DASH" | jq -r '.data[0].payload.feedback')"
# The page address is stored
expect_equal "the page address of the second origin is stored" "http://localhost:5500/?widget=1" "$(echo "$DASH" | jq -r '.data[0].metadata.page_url')"
# The submission was enriched
expect_equal "the submission was enriched with geo data" "mock-a" "$(echo "$DASH" | jq -r '.data[0].geo.provider')"

# A bot on the customer page fills the hidden honeypot
BOT=$(curl -s -w '|%{http_code}' -X POST "$SUBMIT_URL" -H "Origin: $SITE_URL" -H 'Content-Type: application/json' -H 'x-test-client-ip: 198.51.100.142' \
  -d '{"widget_id":1,"data":{"name":"Bot","email":"bot@example.com","website":"http://spam.example"},"metadata":{"page_url":"http://localhost:5500/?widget=1"}}')
# It is told "success"
expect_equal "a bot filling the honeypot gets a normal-looking 201" "201" "${BOT##*|}"
# But nothing is stored
expect_equal "the bot's submission was not stored (dashboard total unchanged)" "$((TOTAL_BEFORE + 1))" "$(curl -s "$BASE_URL/api/dashboard/submissions?widget_id=1&limit=1" -H "Authorization: Bearer $DEMO_TOKEN" | jq -r '.pagination.total')"

# ------------------------------------------------------------------------------
# SUMMARY
# ------------------------------------------------------------------------------
echo ""
echo "=========================================================="
echo " Test Execution Summary: $PASSED Passed, $FAILED Failed"
echo "=========================================================="

# Exit with a failure code when any check failed (so "&&" chains stop)
if [ "$FAILED" -gt 0 ]; then
  # Signal failure
  exit 1
fi
# Signal success
exit 0
