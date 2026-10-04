#!/bin/bash
# ==============================================================================
# FlyRank Capstone - Stage 5 Test Suite: Protection, Enrichment & Safe Side Effects
# Needs: bash, curl, jq, xargs and the docker compose CLI (to read the database and the app log).
# Run it from the project folder with the system already running (docker compose up).
# ==============================================================================

# Base URL of the running API
BASE_URL="http://localhost:3000"
# The public submission endpoint
SUBMIT_URL="$BASE_URL/api/embed/submit"
# Counter of passed checks
PASSED=0
# Counter of failed checks
FAILED=0

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

# Runs one SQL query inside the PostgreSQL container and prints the bare result (spaces and carriage returns removed)
db() {
  # -tA = tuples only, unaligned; -c = run this one query
  docker compose exec -T postgres psql -U postgres -d flyrank_db -tAc "$1" 2>/dev/null | tr -d '\r' | tr -d ' '
}

# Prints the last two minutes of the app container's log (used to prove the email retry and alert)
app_logs() {
  # --no-log-prefix removes the container name at the start of each line
  docker compose logs --no-log-prefix --since 120s app 2>/dev/null
}

# Sends one submission and prints "<response body>|<http status>"
# Arguments: 1 = widget id, 2 = JSON object for the form fields, 3 = pretend visitor IP, 4 = optional extra header
submit() {
  # Array that will hold the optional extra header (empty when none is given)
  local extra=()
  # If a fourth argument was given, add it as a curl header
  if [ -n "$4" ]; then
    # Build the "-H <header>" pair
    extra=(-H "$4")
  fi
  # -w appends "|<status>" after the body so one variable holds both
  curl -s -w '|%{http_code}' -X POST "$SUBMIT_URL" \
    -H 'Content-Type: application/json' \
    -H "x-test-client-ip: $3" \
    "${extra[@]}" \
    -d "{\"widget_id\":$1,\"data\":$2}"
}

echo "=========================================================="
echo " Starting Stage 5: Protection, Enrichment & Safe Side Effects"
echo " Target API Server: $BASE_URL"
echo "=========================================================="

# ------------------------------------------------------------------------------
# SETUP: make sure the database is reachable, then create a tenant and three fresh widgets
# (fresh widgets keep each test's rate-limit buckets independent)
# ------------------------------------------------------------------------------
echo ""
echo "[Setup] Checking database access and creating test widgets..."

# The tests read the database through docker compose; stop with a clear message if that does not work
if [ "$(db 'SELECT 1;')" != "1" ]; then
  # Explain what is missing
  echo "  ❌ FAIL: cannot query PostgreSQL with 'docker compose exec'. Run this from the project folder with the stack running."
  # Stop the whole script
  exit 1
fi
# Report that database access works
echo "  database access OK"

# Unique email so repeated runs never collide
TEST_EMAIL="stage5_$(date +%s)@example.com"
# Register a tenant (the response is not needed, only the login token)
curl -s -o /dev/null -X POST "$BASE_URL/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"password123\",\"company_name\":\"Stage 5 Corp\"}"
# Log in and extract the JWT token
TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"password123\"}" | jq -r '.token')
# Stop early if no token came back
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  # Explain the problem
  echo "  ❌ FAIL: could not log in to create test widgets"
  # Stop the whole script
  exit 1
fi

# Helper: creates a widget and prints its id
create_widget() {
  # POST the widget with the token and read the id from the JSON reply
  curl -s -X POST "$BASE_URL/api/widgets" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"type\":\"signup_form\",\"config\":{\"title\":\"Stage 5\"}}" | jq -r '.id'
}

# Widget for the spam, geo and email tests
W_MAIN=$(create_widget "Stage 5 main widget")
# Widget for the per-IP burst test
W_IP=$(create_widget "Stage 5 IP burst widget")
# Widget for the per-widget flood test
W_FLOOD=$(create_widget "Stage 5 flood widget")
# Show the ids that were created
echo "  widgets created: main=$W_MAIN ip-burst=$W_IP flood=$W_FLOOD"

# Pre-flight: these tests need the server to run with TEST_CONTROLS=true and GEO_MODE=mock.
# Probe: with "provider A down" the mock chain must answer from provider B. Any other answer means the switches are off.
PROBE=$(submit "$W_MAIN" '{"name":"preflight"}' 198.51.100.250 'x-test-geo-down: a')
# Read which provider answered
PROBE_PROVIDER=$(echo "${PROBE%|*}" | jq -r '.enrichment.provider // "none"')
# Stop with a clear explanation if the switches are not active
if [ "$PROBE_PROVIDER" != "mock-b" ]; then
  # Explain what to change
  echo "  ❌ FAIL: the server is not running with TEST_CONTROLS=true and GEO_MODE=mock (provider answered: $PROBE_PROVIDER)."
  # Tell the user the fix
  echo "     Copy .env.example to .env (it enables both), then restart: docker compose down -v && docker compose up --build"
  # Stop the whole script
  exit 1
fi
# Report that the switches are active
echo "  test controls active (TEST_CONTROLS=true, GEO_MODE=mock)"

# ------------------------------------------------------------------------------
# TEST SUITE 1: Spam control (honeypot)
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 1] Honeypot: a bot that fills the hidden 'website' field is dropped..."

# Count rows before the spam submission
BEFORE=$(db "SELECT count(*) FROM submissions WHERE widget_id=$W_MAIN;")
# Send a submission whose hidden honeypot field is filled in, like a bot would
RESP=$(submit "$W_MAIN" '{"name":"Spam Bot","website":"http://spam.example"}' 198.51.100.1)
# Everything after the last | is the status code
CODE="${RESP##*|}"
# Everything before the last | is the body
BODY="${RESP%|*}"
# The bot must get a normal-looking success reply
expect_equal "honeypot submission gets the normal success status" "201" "$CODE"
# The reply must not contain a submission id because nothing was stored
expect_equal "honeypot reply has no submission_id" "none" "$(echo "$BODY" | jq -r '.submission_id // "none"')"
# Count rows after the spam submission
AFTER=$(db "SELECT count(*) FROM submissions WHERE widget_id=$W_MAIN;")
# The row count must be unchanged: the spam was NOT stored
expect_equal "honeypot spam was NOT stored (row count unchanged)" "$BEFORE" "$AFTER"

# Now a normal visitor with an empty honeypot field
RESP=$(submit "$W_MAIN" '{"name":"Real Person","website":""}' 198.51.100.1)
# Status code of the normal submission
CODE="${RESP##*|}"
# Body of the normal submission
BODY="${RESP%|*}"
# A real visitor is stored
expect_equal "normal submission (empty honeypot) is accepted" "201" "$CODE"
# The reply must contain a numeric submission id
expect_equal "normal submission is stored (has submission_id)" "true" "$(echo "$BODY" | jq -r '(.submission_id | type) == "number"')"
# One more row than before
expect_equal "normal submission added exactly one row" "$((BEFORE + 1))" "$(db "SELECT count(*) FROM submissions WHERE widget_id=$W_MAIN;")"

# ------------------------------------------------------------------------------
# TEST SUITE 2: Geo enrichment fallback chain
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 2] Geo fallback chain: A -> B -> store anyway..."

# Provider A is up: it should answer
RESP=$(submit "$W_MAIN" '{"name":"Geo A"}' 198.51.100.2)
# Status code
CODE="${RESP##*|}"
# Body
BODY="${RESP%|*}"
# Id of the stored row
ID=$(echo "$BODY" | jq -r '.submission_id')
# Success status
expect_equal "A up: submission accepted" "201" "$CODE"
# The response says provider A answered
expect_equal "A up: response names provider A" "mock-a" "$(echo "$BODY" | jq -r '.enrichment.provider')"
# The database row holds the same provider name
expect_equal "A up: geo stored in the database" "mock-a" "$(db "SELECT geo->>'provider' FROM submissions WHERE id=$ID;")"

# Provider A is switched down: provider B should answer
RESP=$(submit "$W_MAIN" '{"name":"Geo B"}' 198.51.100.3 'x-test-geo-down: a')
# Status code
CODE="${RESP##*|}"
# Body
BODY="${RESP%|*}"
# Id of the stored row
ID=$(echo "$BODY" | jq -r '.submission_id')
# Success status
expect_equal "A down: submission still accepted" "201" "$CODE"
# The response says provider B answered
expect_equal "A down: response names provider B" "mock-b" "$(echo "$BODY" | jq -r '.enrichment.provider')"
# The database row holds provider B
expect_equal "A down: enriched by provider B in the database" "mock-b" "$(db "SELECT geo->>'provider' FROM submissions WHERE id=$ID;")"

# Both providers are switched down: the submission must still succeed, without geo data
RESP=$(submit "$W_MAIN" '{"name":"Geo none"}' 198.51.100.4 'x-test-geo-down: a,b')
# Status code
CODE="${RESP##*|}"
# Body
BODY="${RESP%|*}"
# Id of the stored row
ID=$(echo "$BODY" | jq -r '.submission_id')
# Success status
expect_equal "A and B down: submission still accepted" "201" "$CODE"
# The response reports enrichment as unavailable
expect_equal "A and B down: enrichment reported unavailable" "unavailable" "$(echo "$BODY" | jq -r '.enrichment.status')"
# The row exists
expect_equal "A and B down: submission was stored" "1" "$(db "SELECT count(*) FROM submissions WHERE id=$ID;")"
# The geo column is empty
expect_equal "A and B down: stored without geo data (geo IS NULL)" "t" "$(db "SELECT geo IS NULL FROM submissions WHERE id=$ID;")"

# ------------------------------------------------------------------------------
# TEST SUITE 3: Safe side effect (confirmation email)
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 3] Confirmation email: failure must not break the submission..."

# Normal case: the email works
RESP=$(submit "$W_MAIN" '{"name":"Mail ok","email":"visitor@example.com"}' 198.51.100.5)
# Status code
CODE="${RESP##*|}"
# Id of the stored row
ID=$(echo "${RESP%|*}" | jq -r '.submission_id')
# Success status
expect_equal "email works: submission accepted" "201" "$CODE"
# Give the background job a moment to run
sleep 2
# The log must contain an email_sent line for this submission
expect_equal "email works: confirmation was sent (log line found)" "1" "$(app_logs | grep '"event":"email_sent"' | grep -c -E "\"submission_id\":$ID[,}]" | sed 's/^[1-9][0-9]*$/1/')"

# Failure case: force the email to throw
RESP=$(submit "$W_MAIN" '{"name":"Mail fails","email":"visitor@example.com"}' 198.51.100.6 'x-test-notify-fail: true')
# Status code
CODE="${RESP##*|}"
# Id of the stored row
ID=$(echo "${RESP%|*}" | jq -r '.submission_id')
# The visitor still gets success
expect_equal "email fails: submission still accepted" "201" "$CODE"
# The row is stored
expect_equal "email fails: submission was stored" "1" "$(db "SELECT count(*) FROM submissions WHERE id=$ID;")"
# Wait for the retries to finish (3 attempts with growing delays)
sleep 4
# The log must contain the failure alert for this submission
expect_equal "email fails: failure alert raised in the log" "1" "$(app_logs | grep '"event":"ALERT"' | grep -c -E "\"submission_id\":$ID[,}]" | sed 's/^[1-9][0-9]*$/1/')"

# ------------------------------------------------------------------------------
# TEST SUITE 4: Per-IP rate limiting under a burst
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 4] Per-IP rate limit: 40 rapid requests from one visitor..."

# Fire 40 requests, 20 at a time, all pretending to be the same visitor; each output line is "<body>|<status>"
BURST=$(seq 1 40 | xargs -P 20 -I @@ curl -s -w '|%{http_code}\n' -X POST "$SUBMIT_URL" \
  -H 'Content-Type: application/json' -H 'x-test-client-ip: 198.51.100.50' \
  -d "{\"widget_id\":$W_IP,\"data\":{\"note\":\"burst\"}}")
# How many were accepted
OK_COUNT=$(echo "$BURST" | grep -c '|201$')
# How many were rate limited
LIMITED_COUNT=$(echo "$BURST" | grep -c '|429$')
# How many were server errors (must be zero)
ERROR_COUNT=$(echo "$BURST" | grep -c -E '\|5[0-9][0-9]$')
# How many of the 429 replies named the IP limiter
IP_SCOPE_COUNT=$(echo "$BURST" | grep '|429$' | grep -c '"scope":"ip"')
# Show the totals so the output is evidence on its own
echo "  results: accepted=$OK_COUNT rate_limited=$LIMITED_COUNT server_errors=$ERROR_COUNT"
# Some requests must have been accepted (the burst allowance)
if [ "$OK_COUNT" -ge 1 ]; then pass "burst: the first requests were accepted ($OK_COUNT)"; else fail "burst: nothing was accepted"; fi
# Some requests must have been blocked with 429
if [ "$LIMITED_COUNT" -ge 1 ]; then pass "burst: excess requests got 429 ($LIMITED_COUNT)"; else fail "burst: no 429 appeared"; fi
# The 429 body must name the ip scope
if [ "$IP_SCOPE_COUNT" -ge 1 ]; then pass "burst: 429 body names scope 'ip' and is JSON"; else fail "burst: no 429 body with scope ip"; fi
# Never a server error
expect_equal "burst: no 5xx errors" "0" "$ERROR_COUNT"

# A different visitor, right after the burst, must be served immediately
RESP=$(submit "$W_IP" '{"note":"other visitor"}' 198.51.100.51)
# Different visitors have their own bucket
expect_equal "right after the burst a different visitor is still served" "201" "${RESP##*|}"
# The API itself is still healthy
expect_equal "right after the burst /health still answers" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/health")"
# Wait for the bucket of the flooding visitor to refill (about 2 tokens per second)
sleep 2
# The same visitor recovers after a short pause
RESP=$(submit "$W_IP" '{"note":"recovered"}' 198.51.100.50)
# A normal request after the pause succeeds
expect_equal "after a 2 second pause the same visitor succeeds again" "201" "${RESP##*|}"

# ------------------------------------------------------------------------------
# TEST SUITE 5: Per-widget rate limiting (many different visitors, one widget)
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 5] Per-widget rate limit: 60 requests from 60 different visitors to one widget..."

# Each request pretends to be a different visitor (203.0.113.1 ... 203.0.113.60), so the per-IP limit never triggers
FLOOD=$(seq 1 60 | xargs -P 30 -I @@ curl -s -w '|%{http_code}\n' -X POST "$SUBMIT_URL" \
  -H 'Content-Type: application/json' -H 'x-test-client-ip: 203.0.113.@@' \
  -d "{\"widget_id\":$W_FLOOD,\"data\":{\"note\":\"flood\"}}")
# How many were accepted
OK_COUNT=$(echo "$FLOOD" | grep -c '|201$')
# How many were rate limited
LIMITED_COUNT=$(echo "$FLOOD" | grep -c '|429$')
# How many were server errors (must be zero)
ERROR_COUNT=$(echo "$FLOOD" | grep -c -E '\|5[0-9][0-9]$')
# How many of the 429 replies named the widget limiter
WIDGET_SCOPE_COUNT=$(echo "$FLOOD" | grep '|429$' | grep -c '"scope":"widget"')
# Show the totals
echo "  results: accepted=$OK_COUNT rate_limited=$LIMITED_COUNT server_errors=$ERROR_COUNT"
# Some were accepted
if [ "$OK_COUNT" -ge 1 ]; then pass "flood: the first requests were accepted ($OK_COUNT)"; else fail "flood: nothing was accepted"; fi
# Some were blocked
if [ "$LIMITED_COUNT" -ge 1 ]; then pass "flood: excess requests got 429 ($LIMITED_COUNT)"; else fail "flood: no 429 appeared"; fi
# The 429 body names the widget scope
if [ "$WIDGET_SCOPE_COUNT" -ge 1 ]; then pass "flood: 429 body names scope 'widget'"; else fail "flood: no 429 body with scope widget"; fi
# Never a server error
expect_equal "flood: no 5xx errors" "0" "$ERROR_COUNT"

# The seeded widget 1 belongs to nobody in this flood, so it must still accept a new visitor straight away
RESP=$(submit 1 '{"note":"other widget"}' 203.0.113.200)
# Other widgets are unaffected
expect_equal "during the flood another widget is still served" "201" "${RESP##*|}"
# The API is still healthy
expect_equal "after the flood /health still answers" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/health")"

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
