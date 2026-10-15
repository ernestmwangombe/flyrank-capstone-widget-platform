#!/bin/bash
# ==============================================================================
# FlyRank Capstone - Stage 8 Test Suite: Idempotency Key on Submissions
# Needs: bash, curl, jq, xargs and the docker compose CLI (to read the app log), with the whole system running
# and TEST_CONTROLS=true, GEO_MODE=mock (same settings as Stages 5 to 7).
# Idea: a retried request (same Idempotency-Key, same content) must happen ONCE: one stored row, one confirmation email.
# ==============================================================================

# Base URL of the API
BASE_URL="http://localhost:3000"
# Base URL of the customer test site (the second origin the widget runs on)
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

# Passes when the text contains a fragment (case-insensitive); long texts are not dumped, only the fragment is reported
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
send() {
  # -D saves the response headers, -o the body, -w prints the status
  curl -s -D "$TMP_DIR/headers" -o "$TMP_DIR/body" -w '%{http_code}' "$@"
}

# Sends one submission as the widget would, optionally with an Idempotency-Key; prints the status code
# Arguments: 1 = widget id, 2 = pretend visitor IP, 3 = key (empty for none), 4 = JSON object with the form answers
submit_key() {
  # Array that will hold the optional key header
  local extra=()
  # Add the header only when a key was given
  if [ -n "$3" ]; then
    # Build the "-H <header>" pair
    extra=(-H "Idempotency-Key: $3")
  fi
  # Send the request (the Origin header makes it look like it comes from the customer's page)
  send -X POST "$SUBMIT_URL" -H 'Content-Type: application/json' -H "Origin: $SITE_URL" -H "x-test-client-ip: $2" "${extra[@]}" \
    -d "{\"widget_id\":$1,\"data\":$4}"
}

# Prints how many submissions the demo owner's dashboard shows for a widget
dashboard_total() {
  # Ask the dashboard API for one row and read the pagination total
  curl -s "$BASE_URL/api/dashboard/submissions?widget_id=$1&limit=1" -H "Authorization: Bearer $DEMO_TOKEN" | jq -r '.pagination.total'
}

# Prints how many "confirmation sent" log lines exist for a submission id (the log of the last two minutes)
emails_sent_for() {
  # Search the structured log lines for this submission id; the id must end the number, not just start it
  docker compose logs --no-log-prefix --since 120s app 2>/dev/null | grep '"event":"email_sent"' | grep -c -E "\"submission_id\":$1[,}]"
}

echo "=========================================================="
echo " Starting Stage 8: Idempotency Key on Submissions"
echo " API: $BASE_URL"
echo "=========================================================="

# ------------------------------------------------------------------------------
# SETUP AND PRE-FLIGHT
# ------------------------------------------------------------------------------
echo ""
echo "[Setup] Logging in as the demo owner and creating two fresh widgets..."

# Log in as the seeded demo owner
DEMO_TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"dev@flyrank.ai","password":"DemoPass123!"}' | jq -r '.token')
# Stop with a clear explanation if the login fails
if [ -z "$DEMO_TOKEN" ] || [ "$DEMO_TOKEN" = "null" ]; then
  # Explain what is wrong
  echo "  ❌ FAIL: the demo owner cannot log in. Re-seed: docker compose exec -T postgres psql -U postgres -d flyrank_db < schema.sql"
  # Stop the whole script
  exit 1
fi
# The tests read the app log through docker compose; stop with a clear message if that does not work
if ! docker compose logs --no-log-prefix --since 5s app >/dev/null 2>&1; then
  # Explain what is missing
  echo "  ❌ FAIL: 'docker compose logs' does not work here. Run this from the project folder with the stack running."
  # Stop the whole script
  exit 1
fi

# Creates a widget as the demo owner and prints "<id> <embed snippet>"
create_widget() {
  # POST the widget and read the id and the snippet from the JSON reply
  curl -s -X POST "$BASE_URL/api/widgets" -H "Authorization: Bearer $DEMO_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"type\":\"signup_form\",\"config\":{\"title\":\"Stage 8\"}}" | jq -r '"\(.id) \(.embed_snippet)"'
}
# Widget A (most tests) and its snippet
WA_LINE=$(create_widget "Stage 8 widget A")
# Widget B (used to show that keys are scoped per widget)
WB_LINE=$(create_widget "Stage 8 widget B")
# Split the lines into the id and the snippet
WA="${WA_LINE%% *}"
# Widget B's id
WB="${WB_LINE%% *}"
# New snippets must point at version 3 (the loader that sends the key)
if ! echo "$WA_LINE" | grep -q 'widget\.v3\.js'; then
  # Explain what is wrong
  echo "  ❌ FAIL: new embed snippets do not use widget.v3.js (got: ${WA_LINE#* })."
  # Tell the user the fix
  echo "     Your .env still names an older WIDGET_VERSION. Change it to WIDGET_VERSION=3 (or delete the line) and restart."
  # Stop the whole script
  exit 1
fi
# Show the ids
echo "  widgets: A=$WA B=$WB (new snippets use version 3)"
# A key prefix that is unique to this run, so repeated runs never collide
RUN="s8$(date +%s)"

# ------------------------------------------------------------------------------
# TEST SUITE 1: a retry with the same key happens once
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 1] Same key, same content: stored once, answered from the original..."

# The first request
K1="$RUN-key-one"
# Send it (it includes an email address, so a confirmation email is queued)
C1=$(submit_key "$WA" 198.51.100.151 "$K1" '{"name":"Retry me","email":"retry@example.com"}')
# Its id and creation time
ID1=$(jq -r '.submission_id' "$TMP_DIR/body")
# The time it was created
CREATED1=$(jq -r '.created_at' "$TMP_DIR/body")
# The first request is a normal success
expect_equal "first request with a key is accepted" "201" "$C1"
# It is not marked as a replay
expect_equal "first request is not marked as a replay" "" "$(header_value "$TMP_DIR/headers" idempotent-replayed)"
# Retry it exactly (as a client would after a lost reply)
C2=$(submit_key "$WA" 198.51.100.151 "$K1" '{"name":"Retry me","email":"retry@example.com"}')
# The retry looks like the original success
expect_equal "the retry is answered with the same 201" "201" "$C2"
# It names the same submission
expect_equal "the retry returns the ORIGINAL submission id" "$ID1" "$(jq -r '.submission_id' "$TMP_DIR/body")"
# And the same creation time
expect_equal "the retry returns the original creation time" "$CREATED1" "$(jq -r '.created_at' "$TMP_DIR/body")"
# It is marked as a replay in a header
expect_equal "the retry is marked with the Idempotent-Replayed header" "true" "$(header_value "$TMP_DIR/headers" idempotent-replayed)"
# And in the body
expect_equal "the retry body says idempotent_replay: true" "true" "$(jq -r '.idempotent_replay' "$TMP_DIR/body")"
# A third retry
C3=$(submit_key "$WA" 198.51.100.151 "$K1" '{"email":"retry@example.com","name":"Retry me"}')
# Same answer, even with the fields listed in a different order
expect_equal "a third retry (fields in another order) still returns the original" "$ID1" "$(jq -r '.submission_id' "$TMP_DIR/body")"
# Only ONE row exists
expect_equal "the dashboard shows exactly one stored submission" "1" "$(dashboard_total "$WA")"
# Give the background email job time to run
sleep 2
# And only ONE confirmation email was sent for the three requests
expect_equal "exactly one confirmation email was sent for the three requests" "1" "$(emails_sent_for "$ID1")"

# ------------------------------------------------------------------------------
# TEST SUITE 2: different keys are different submissions
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 2] A different key is a new submission..."

# Same content, new key
C=$(submit_key "$WA" 198.51.100.152 "$RUN-key-two" '{"name":"Retry me","email":"retry@example.com"}')
# Accepted
expect_equal "same content with a new key is accepted" "201" "$C"
# A new id
ID2=$(jq -r '.submission_id' "$TMP_DIR/body")
# Not the first one
if [ "$ID2" != "$ID1" ]; then pass "a new key creates a new submission (id $ID2, not $ID1)"; else fail "a new key returned the old submission"; fi
# Not marked as a replay
expect_equal "it is not marked as a replay" "" "$(header_value "$TMP_DIR/headers" idempotent-replayed)"
# Two rows now
expect_equal "the dashboard shows two submissions" "2" "$(dashboard_total "$WA")"

# ------------------------------------------------------------------------------
# TEST SUITE 3: no key behaves exactly as before
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 3] Without a key every request is stored (backward compatible)..."

# Two identical requests without any key
C=$(submit_key "$WA" 198.51.100.153 "" '{"name":"No key"}')
# Accepted
expect_equal "request without a key is accepted" "201" "$C"
# Its id
IDN1=$(jq -r '.submission_id' "$TMP_DIR/body")
# The second one
submit_key "$WA" 198.51.100.153 "" '{"name":"No key"}' > /dev/null
# Its id
IDN2=$(jq -r '.submission_id' "$TMP_DIR/body")
# Different rows
if [ "$IDN1" != "$IDN2" ]; then pass "two identical requests without a key are stored separately ($IDN1 and $IDN2)"; else fail "requests without a key were merged"; fi
# Four rows in total
expect_equal "the dashboard shows four submissions" "4" "$(dashboard_total "$WA")"

# ------------------------------------------------------------------------------
# TEST SUITE 4: the same key with different content is refused
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 4] Same key, different content: 409 Conflict..."

# Reuse key one with different answers
C=$(submit_key "$WA" 198.51.100.154 "$K1" '{"name":"Someone else","email":"other@example.com"}')
# Refused
expect_equal "a reused key with different content is refused (409)" "409" "$C"
# JSON error
expect_equal "the 409 body is a JSON error" "Conflict" "$(jq -r '.error' "$TMP_DIR/body")"
# Nothing was stored
expect_equal "nothing new was stored" "4" "$(dashboard_total "$WA")"
# The original submission is unchanged
ORIG=$(curl -s "$BASE_URL/api/dashboard/submissions/$ID1" -H "Authorization: Bearer $DEMO_TOKEN" | jq -r '.payload.name')
# Still the first visitor's answers
expect_equal "the original submission is unchanged" "Retry me" "$ORIG"

# ------------------------------------------------------------------------------
# TEST SUITE 5: keys are scoped to one widget
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 5] The same key on another widget is independent..."

# Use key one on widget B
C=$(submit_key "$WB" 198.51.100.155 "$K1" '{"name":"Retry me","email":"retry@example.com"}')
# Accepted as a new submission
expect_equal "the same key on a different widget is accepted" "201" "$C"
# A new id
IDB=$(jq -r '.submission_id' "$TMP_DIR/body")
# Not the widget A submission
if [ "$IDB" != "$ID1" ]; then pass "widget B got its own submission (id $IDB)"; else fail "widget B returned widget A's submission"; fi
# Not a replay
expect_equal "it is not marked as a replay" "" "$(header_value "$TMP_DIR/headers" idempotent-replayed)"
# Widget B has one
expect_equal "widget B shows one submission" "1" "$(dashboard_total "$WB")"
# And retrying on widget B is a replay on widget B
submit_key "$WB" 198.51.100.155 "$K1" '{"name":"Retry me","email":"retry@example.com"}' > /dev/null
# The original B submission
expect_equal "a retry on widget B returns widget B's submission" "$IDB" "$(jq -r '.submission_id' "$TMP_DIR/body")"

# ------------------------------------------------------------------------------
# TEST SUITE 6: malformed keys are rejected with a clean 400
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 6] Malformed keys are refused (400) and nothing is stored..."

# Too short
C=$(submit_key "$WA" 198.51.100.156 "abc" '{"name":"bad key"}')
# Refused
expect_equal "a key shorter than 8 characters gives 400" "400" "$C"
# The error names the header
expect_equal "the error names the Idempotency-Key header" "Idempotency-Key" "$(jq -r '.details[0].field' "$TMP_DIR/body")"
# Too long: 129 characters
LONG_KEY=$(head -c 129 /dev/zero | tr '\0' 'a')
# Refused
expect_equal "a key longer than 128 characters gives 400" "400" "$(submit_key "$WA" 198.51.100.157 "$LONG_KEY" '{"name":"bad key"}')"
# Spaces
expect_equal "a key with spaces gives 400" "400" "$(submit_key "$WA" 198.51.100.158 "has spaces in it" '{"name":"bad key"}')"
# Slashes
expect_equal "a key with slashes gives 400" "400" "$(submit_key "$WA" 198.51.100.159 "bad/slash/key1" '{"name":"bad key"}')"
# Commas (several headers are joined with commas)
expect_equal "a key with a comma gives 400" "400" "$(submit_key "$WA" 198.51.100.160 "aaaaaaaa,bbbbbbbb" '{"name":"bad key"}')"
# An empty header value
EMPTY=$(send -X POST "$SUBMIT_URL" -H 'Content-Type: application/json' -H 'Idempotency-Key;' -H 'x-test-client-ip: 198.51.100.161' -d "{\"widget_id\":$WA,\"data\":{\"name\":\"bad key\"}}")
# Refused
expect_equal "an empty key gives 400" "400" "$EMPTY"
# The error is JSON and readable cross-origin
expect_equal "the 400 for a bad key carries the CORS header" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"
# Nothing was stored
expect_equal "none of the malformed requests was stored" "4" "$(dashboard_total "$WA")"

# ------------------------------------------------------------------------------
# TEST SUITE 7: simultaneous retries (a race) still create one row and one email
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 7] 8 simultaneous requests with the same key..."

# One new key for the whole race
KC="$RUN-race"
# Send 8 identical requests at the same moment from the same visitor
RACE=$(seq 1 8 | xargs -P 8 -I @@ curl -s -w '|%{http_code}\n' -X POST "$SUBMIT_URL" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $KC" -H 'x-test-client-ip: 198.51.100.170' \
  -d "{\"widget_id\":$WA,\"data\":{\"name\":\"Race\",\"email\":\"race@example.com\"}}")
# How many answered 201
expect_equal "all 8 simultaneous requests were answered with 201" "8" "$(echo "$RACE" | grep -c '|201$')"
# How many distinct submission ids came back
expect_equal "they all name the same single submission" "1" "$(echo "$RACE" | sed 's/|[0-9]*$//' | jq -r '.submission_id' | sort -u | wc -l | tr -d ' ')"
# Exactly one of them created the row (it has no idempotent_replay flag)
expect_equal "exactly one of the 8 created the submission, the other 7 are replays" "1" "$(echo "$RACE" | grep -c -v 'idempotent_replay')"
# One more row in the dashboard
expect_equal "the dashboard grew by exactly one (5 submissions)" "5" "$(dashboard_total "$WA")"
# The id of the race submission
RACE_ID=$(echo "$RACE" | head -1 | sed 's/|[0-9]*$//' | jq -r '.submission_id')
# Give the background email job time to run
sleep 2
# Exactly one confirmation email
expect_equal "exactly one confirmation email was sent for the 8 requests" "1" "$(emails_sent_for "$RACE_ID")"

# ------------------------------------------------------------------------------
# TEST SUITE 8: CORS for the new header (the browser preflight must allow it)
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 8] CORS allows the Idempotency-Key header and exposes the replay header..."

# The preflight a browser sends when the widget adds the Idempotency-Key header
PRE=$(send -X OPTIONS "$SUBMIT_URL" -H "Origin: $SITE_URL" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type,idempotency-key')
# Accepted
expect_equal "preflight asking for idempotency-key returns 204" "204" "$PRE"
# The header is allowed
expect_contains "preflight allows the Idempotency-Key header" "idempotency-key" "$(header_value "$TMP_DIR/headers" access-control-allow-headers)"
# Content-Type is still allowed
expect_contains "preflight still allows Content-Type" "content-type" "$(header_value "$TMP_DIR/headers" access-control-allow-headers)"
# A replay seen from the customer origin
submit_key "$WA" 198.51.100.171 "$K1" '{"name":"Retry me","email":"retry@example.com"}' > /dev/null
# Readable by the page
expect_equal "a replay response allows the customer origin" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"
# The replay header can be read by browser code
expect_contains "Idempotent-Replayed is exposed to browser code" "idempotent-replayed" "$(header_value "$TMP_DIR/headers" access-control-expose-headers)"
# The 409 is readable too
submit_key "$WA" 198.51.100.172 "$K1" '{"name":"Different"}' > /dev/null
# Readable by the page
expect_equal "the 409 response allows the customer origin" "*" "$(header_value "$TMP_DIR/headers" access-control-allow-origin)"

# ------------------------------------------------------------------------------
# TEST SUITE 9: the widget bundle that sends the key (version 3) and the frozen older versions
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 9] Widget bundle version 3..."

# Download version 3
V3=$(send "$BASE_URL/widget.v3.js?id=1")
# Served
expect_equal "GET /widget.v3.js returns 200" "200" "$V3"
# Cached for a year
expect_equal "version 3 has the long-term cache header" "public, max-age=31536000, immutable" "$(header_value "$TMP_DIR/headers" cache-control)"
# Keep a copy
cp "$TMP_DIR/body" "$TMP_DIR/v3.js"
# Sends the key
expect_contains "version 3 sends the Idempotency-Key header" "Idempotency-Key" "$(cat "$TMP_DIR/v3.js")"
# Uses strong random numbers for the key
expect_contains "version 3 makes keys with crypto.getRandomValues" "getRandomValues" "$(cat "$TMP_DIR/v3.js")"
# Still safe
if grep -q 'innerHTML' "$TMP_DIR/v3.js"; then fail "version 3 uses innerHTML"; else pass "version 3 does not use innerHTML"; fi
# No comments shipped
expect_equal "no comment lines shipped in version 3" "0" "$(grep -c '^//' "$TMP_DIR/v3.js")"
# Small
V3_SIZE=$(wc -c < "$TMP_DIR/v3.js" | tr -d ' ')
# Under 10 KB
if [ "$V3_SIZE" -le 10240 ]; then pass "version 3 is small ($V3_SIZE bytes, limit 10240)"; else fail "version 3 is too large ($V3_SIZE bytes)"; fi
# Version 2 is still served and is the OLD code (published versions never change)
V2=$(send "$BASE_URL/widget.v2.js?id=1")
# Served
expect_equal "version 2 is still served" "200" "$V2"
# Without the key logic
if grep -q 'Idempotency-Key' "$TMP_DIR/body"; then fail "version 2 changed (it now mentions Idempotency-Key)"; else pass "version 2 is unchanged (no Idempotency-Key in it)"; fi
# Version 1 too
expect_equal "version 1 is still served" "200" "$(send "$BASE_URL/widget.v1.js?id=1")"
# The unversioned URL tracks the current version
send "$BASE_URL/widget.js?id=1" > /dev/null
# Same bytes as version 3
if cmp -s "$TMP_DIR/body" "$TMP_DIR/v3.js"; then pass "the unversioned /widget.js serves the current version (same bytes as v3)"; else fail "/widget.js does not match version 3"; fi
# The customer page embeds version 3
expect_contains "the customer test page loads widget.v3.js" "widget.v3.js" "$(curl -s "$SITE_URL/")"

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
