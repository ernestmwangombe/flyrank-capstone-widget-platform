#!/bin/bash
# ==============================================================================
# FlyRank Capstone - Stage 6 Test Suite: Owner Dashboard API
# Needs: bash, curl and jq, with the system running (docker compose up) and TEST_CONTROLS=true, GEO_MODE=mock
# (the same settings as Stage 5, so the geo results below are predictable).
# ==============================================================================

# Base URL of the running API
BASE_URL="http://localhost:3000"
# The public submission endpoint
SUBMIT_URL="$BASE_URL/api/embed/submit"
# The dashboard API root
DASH_URL="$BASE_URL/api/dashboard"
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

# Calls a dashboard URL with a token and prints "<body>|<status>"; arguments: 1 = token, 2 = path and query
dash() {
  # -w appends "|<status>" after the body so one variable holds both
  curl -s -w '|%{http_code}' "$DASH_URL$2" -H "Authorization: Bearer $1"
}

# Splits the "<body>|<status>" text: body_of prints the body, code_of prints the status
body_of() { echo "${1%|*}"; }
code_of() { echo "${1##*|}"; }

# Registers a tenant and prints its login token; argument 1 = label
make_tenant_token() {
  # Unique email so repeated runs never collide
  local email="stage6_$1_$(date +%s%N)@example.com"
  # Register (the response is not needed)
  curl -s -o /dev/null -X POST "$BASE_URL/api/auth/register" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"password123\",\"company_name\":\"Stage 6 $1\"}"
  # Log in and print the token
  curl -s -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"password123\"}" | jq -r '.token'
}

# Creates a widget with a token and prints its id; arguments: 1 = token, 2 = name
create_widget() {
  # POST the widget and read the id from the JSON reply
  curl -s -X POST "$BASE_URL/api/widgets" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$2\",\"type\":\"signup_form\",\"config\":{\"title\":\"Stage 6\"}}" | jq -r '.id'
}

# Sends one public submission and prints "<body>|<status>"; arguments: 1 = widget id, 2 = fake visitor IP, 3 = name, 4 = optional extra header
submit() {
  # Array holding the optional extra header
  local extra=()
  # If a fourth argument was given, add it as a curl header
  if [ -n "$4" ]; then
    # Build the "-H <header>" pair
    extra=(-H "$4")
  fi
  # Send the submission; the visitor IP header is a development-only test control
  curl -s -w '|%{http_code}' -X POST "$SUBMIT_URL" -H 'Content-Type: application/json' \
    -H "x-test-client-ip: $2" "${extra[@]}" \
    -d "{\"widget_id\":$1,\"data\":{\"name\":\"$3\"}}"
}

echo "=========================================================="
echo " Starting Stage 6: Owner Dashboard API"
echo " Target API Server: $BASE_URL"
echo "=========================================================="

# ------------------------------------------------------------------------------
# SETUP: two separate owners (A and B) with their own widgets and submissions
# ------------------------------------------------------------------------------
echo ""
echo "[Setup] Creating owners A and B, their widgets and six submissions..."

# Owner A and owner B log in
TOKEN_A=$(make_tenant_token A)
# Owner B
TOKEN_B=$(make_tenant_token B)
# Stop early if either login failed
if [ -z "$TOKEN_A" ] || [ "$TOKEN_A" = "null" ] || [ -z "$TOKEN_B" ] || [ "$TOKEN_B" = "null" ]; then
  # Explain the problem
  echo "  ❌ FAIL: could not obtain login tokens"
  # Stop the whole script
  exit 1
fi

# Owner A has two widgets, owner B has one
WA1=$(create_widget "$TOKEN_A" "Owner A widget one")
# Owner A's second widget
WA2=$(create_widget "$TOKEN_A" "Owner A widget two")
# Owner B's widget
WB1=$(create_widget "$TOKEN_B" "Owner B widget one")
# Show the ids
echo "  widgets: A1=$WA1 A2=$WA2 B1=$WB1"

# Owner A, widget 1: provider A answers (geo: Mockland A)
R1=$(submit "$WA1" 198.51.100.61 "A1 first")
# Owner A, widget 1: provider A down, provider B answers (geo: Mockland B)
R2=$(submit "$WA1" 198.51.100.62 "A1 second" 'x-test-geo-down: a')
# Owner A, widget 1: both providers down (no geo, shown as Unknown)
R3=$(submit "$WA1" 198.51.100.63 "A1 third" 'x-test-geo-down: a,b')
# Owner A, widget 2: provider A answers
R4=$(submit "$WA2" 198.51.100.64 "A2 first")
# Owner B, widget 1: two normal submissions
R5=$(submit "$WB1" 198.51.100.65 "B1 first")
# Owner B's second submission
R6=$(submit "$WB1" 198.51.100.66 "B1 second")

# Pre-flight: the second submission must have been answered by mock provider B, otherwise the test switches are off
PROVIDER_CHECK=$(body_of "$R2" | jq -r '.enrichment.provider // "none"')
# Stop with a clear explanation if the switches are not active
if [ "$PROVIDER_CHECK" != "mock-b" ]; then
  # Explain what to change
  echo "  ❌ FAIL: the server is not running with TEST_CONTROLS=true and GEO_MODE=mock (provider answered: $PROVIDER_CHECK)."
  # Tell the user the fix
  echo "     Copy .env.example to .env (it enables both), then restart: docker compose down -v && docker compose up --build"
  # Stop the whole script
  exit 1
fi
# All six submissions must have been stored (status 201)
ALL_OK=$(for r in "$R1" "$R2" "$R3" "$R4" "$R5" "$R6"; do code_of "$r"; done | sort -u | tr '\n' ' ')
# They should all be 201
expect_equal "setup: all six submissions accepted" "201 " "$ALL_OK"
# Remember the id of owner A's first and owner B's first submission for later checks
ID_A1=$(body_of "$R1" | jq -r '.submission_id')
# Owner B's submission id
ID_B1=$(body_of "$R5" | jq -r '.submission_id')

# ------------------------------------------------------------------------------
# TEST SUITE 1: the dashboard requires a valid login
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 1] Authentication: no valid token, no dashboard..."

# Every dashboard path must refuse a request without a token
for path in "/submissions" "/submissions/$ID_A1" "/stats/widgets" "/stats/over-time" "/stats/geo"; do
  # Call without any Authorization header
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$DASH_URL$path")
  # Must be 401
  expect_equal "no token rejected on $path" "401" "$CODE"
done
# A made-up token must be refused
expect_equal "made-up token rejected" "401" "$(code_of "$(dash 'not.a.real.token' '/submissions')")"
# A tampered token (last characters changed) must be refused
expect_equal "tampered token rejected" "401" "$(code_of "$(dash "${TOKEN_A}x" '/submissions')")"

# ------------------------------------------------------------------------------
# TEST SUITE 2: submissions list, paging and filters
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 2] Submissions list for owner A..."

# Owner A reads their list
RESP=$(dash "$TOKEN_A" '/submissions')
# Status must be 200
expect_equal "owner A list returns 200" "200" "$(code_of "$RESP")"
# Owner A made four submissions in total
expect_equal "owner A sees exactly their 4 submissions (pagination total)" "4" "$(body_of "$RESP" | jq -r '.pagination.total')"
# Every row must belong to one of owner A's widgets
expect_equal "every row belongs to owner A's widgets" "0" "$(body_of "$RESP" | jq --argjson a "$WA1" --argjson b "$WA2" '[.data[] | select(.widget_id != $a and .widget_id != $b)] | length')"
# The newest submission (A2 first) must come first
expect_equal "newest submission is listed first" "A2 first" "$(body_of "$RESP" | jq -r '.data[0].payload.name')"
# Rows carry the stored geo data
expect_equal "rows include the geo data" "Mockland A" "$(body_of "$RESP" | jq -r '[.data[] | select(.payload.name=="A1 first")][0].geo.country')"

# Paging: first page of two
PAGE1=$(dash "$TOKEN_A" '/submissions?limit=2&offset=0')
# Second page of two
PAGE2=$(dash "$TOKEN_A" '/submissions?limit=2&offset=2')
# Each page holds two rows
expect_equal "page 1 holds 2 rows" "2" "$(body_of "$PAGE1" | jq '.data | length')"
# The second page holds the other two
expect_equal "page 2 holds 2 rows" "2" "$(body_of "$PAGE2" | jq '.data | length')"
# The two pages share no ids
expect_equal "pages do not overlap" "4" "$( (body_of "$PAGE1" | jq -r '.data[].id'; body_of "$PAGE2" | jq -r '.data[].id') | sort -u | wc -l | tr -d ' ')"
# The pagination block reports the limit and offset
expect_equal "pagination block reports limit and offset" "2/2" "$(body_of "$PAGE2" | jq -r '"\(.pagination.limit)/\(.pagination.offset)"')"

# Filter by widget
expect_equal "filter by widget A1 returns 3 submissions" "3" "$(body_of "$(dash "$TOKEN_A" "/submissions?widget_id=$WA1")" | jq -r '.pagination.total')"
# The other widget
expect_equal "filter by widget A2 returns 1 submission" "1" "$(body_of "$(dash "$TOKEN_A" "/submissions?widget_id=$WA2")" | jq -r '.pagination.total')"
# A date window in the past returns nothing
expect_equal "a window entirely in the past returns 0 rows" "0" "$(body_of "$(dash "$TOKEN_A" '/submissions?from=2000-01-01&to=2000-01-02')" | jq -r '.pagination.total')"
# A window from the past until tomorrow returns everything (a bare "to" date includes the whole day)
TOMORROW=$(date -u -d 'tomorrow' +%Y-%m-%d 2>/dev/null || date -u -v+1d +%Y-%m-%d)
# Everything is inside that window
expect_equal "a window from 2000 to tomorrow returns all 4" "4" "$(body_of "$(dash "$TOKEN_A" "/submissions?from=2000-01-01&to=$TOMORROW")" | jq -r '.pagination.total')"

# Validation: bad input is a clean 400, never a 500
for bad in "limit=0" "limit=101" "limit=abc" "offset=-1" "widget_id=abc" "widget_id=1;DROP%20TABLE%20widgets" "from=yesterday" "from=2026-13-45" "from=2026-10-05&to=2026-10-01"; do
  # Call with the bad query string
  RESP=$(dash "$TOKEN_A" "/submissions?$bad")
  # Must be 400 with a JSON error
  expect_equal "bad query '$bad' gives 400" "400" "$(code_of "$RESP")"
done
# The validation error body names the problem
expect_equal "validation error lists the field" "limit" "$(body_of "$(dash "$TOKEN_A" '/submissions?limit=0')" | jq -r '.details[0].field')"

# ------------------------------------------------------------------------------
# TEST SUITE 3: tenant isolation (owner B attacks owner A's data and vice versa)
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 3] Tenant isolation: each owner sees only their own data..."

# Owner B's list
RESP=$(dash "$TOKEN_B" '/submissions')
# Owner B made two submissions
expect_equal "owner B sees exactly their 2 submissions" "2" "$(body_of "$RESP" | jq -r '.pagination.total')"
# None of owner A's widgets appear in owner B's list
expect_equal "owner B's list contains none of owner A's widgets" "0" "$(body_of "$RESP" | jq --argjson a "$WA1" --argjson b "$WA2" '[.data[] | select(.widget_id == $a or .widget_id == $b)] | length')"
# Owner B cannot fetch owner A's submission by id
expect_equal "owner B cannot read owner A's submission by id (404)" "404" "$(code_of "$(dash "$TOKEN_B" "/submissions/$ID_A1")")"
# Owner A can fetch their own
expect_equal "owner A can read their own submission by id (200)" "200" "$(code_of "$(dash "$TOKEN_A" "/submissions/$ID_A1")")"
# The single-submission body is the right one
expect_equal "single submission has the right payload" "A1 first" "$(body_of "$(dash "$TOKEN_A" "/submissions/$ID_A1")" | jq -r '.payload.name')"
# Owner A cannot fetch owner B's submission by id
expect_equal "owner A cannot read owner B's submission by id (404)" "404" "$(code_of "$(dash "$TOKEN_A" "/submissions/$ID_B1")")"
# Owner B cannot filter by owner A's widget on any endpoint
for path in "/submissions?widget_id=$WA1" "/stats/over-time?widget_id=$WA1" "/stats/geo?widget_id=$WA1"; do
  # Call as owner B
  CODE=$(code_of "$(dash "$TOKEN_B" "$path")")
  # Must be 404, exactly like a widget that does not exist
  expect_equal "owner B filtering by A's widget on $path gives 404" "404" "$CODE"
done
# A non-existent id gives the same 404
expect_equal "a submission id that does not exist gives 404" "404" "$(code_of "$(dash "$TOKEN_A" '/submissions/999999999')")"
# A bad id is a 400
expect_equal "a non-numeric submission id gives 400" "400" "$(code_of "$(dash "$TOKEN_A" '/submissions/abc')")"

# ------------------------------------------------------------------------------
# TEST SUITE 4: analytics (per widget, over time, geo)
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 4] Analytics endpoints..."

# Per-widget stats for owner A
RESP=$(dash "$TOKEN_A" '/stats/widgets')
# Status
expect_equal "per-widget stats return 200" "200" "$(code_of "$RESP")"
# Owner A has exactly two widgets
expect_equal "owner A sees only their 2 widgets" "2" "$(body_of "$RESP" | jq '.data | length')"
# Widget A1 has three submissions
expect_equal "widget A1 total_submissions" "3" "$(body_of "$RESP" | jq --argjson id "$WA1" '[.data[] | select(.widget_id==$id)][0].total_submissions')"
# Widget A2 has one
expect_equal "widget A2 total_submissions" "1" "$(body_of "$RESP" | jq --argjson id "$WA2" '[.data[] | select(.widget_id==$id)][0].total_submissions')"
# Recent counts include today's submissions
expect_equal "widget A1 last_24h" "3" "$(body_of "$RESP" | jq --argjson id "$WA1" '[.data[] | select(.widget_id==$id)][0].last_24h')"
# Two of A1's three submissions were enriched with geo
expect_equal "widget A1 enriched_submissions (one had no geo)" "2" "$(body_of "$RESP" | jq --argjson id "$WA1" '[.data[] | select(.widget_id==$id)][0].enriched_submissions')"
# The busiest widget comes first
expect_equal "widgets are ordered by total, busiest first" "$WA1" "$(body_of "$RESP" | jq -r '.data[0].widget_id')"
# Owner B sees only their single widget
RESP_B=$(dash "$TOKEN_B" '/stats/widgets')
# One widget
expect_equal "owner B sees only their 1 widget" "1" "$(body_of "$RESP_B" | jq '.data | length')"
# And it is theirs
expect_equal "owner B's widget is B1 with 2 submissions" "$WB1/2" "$(body_of "$RESP_B" | jq -r '"\(.data[0].widget_id)/\(.data[0].total_submissions)"')"

# Counts over time, 7 days
RESP=$(dash "$TOKEN_A" '/stats/over-time?days=7')
# Status
expect_equal "over-time returns 200" "200" "$(code_of "$RESP")"
# Seven entries, one per day, including days with zero submissions
expect_equal "over-time has one entry per day (7)" "7" "$(body_of "$RESP" | jq '.data | length')"
# The counts add up to owner A's four submissions
expect_equal "over-time counts add up to 4" "4" "$(body_of "$RESP" | jq '[.data[].count] | add')"
# The total field agrees
expect_equal "over-time total field is 4" "4" "$(body_of "$RESP" | jq '.total')"
# Days are in ascending order
expect_equal "days are in ascending order" "true" "$(body_of "$RESP" | jq '[.data[].date] == ([.data[].date] | sort)')"
# Filtering to widget A2 leaves one submission
expect_equal "over-time filtered to widget A2 adds up to 1" "1" "$(body_of "$(dash "$TOKEN_A" "/stats/over-time?days=7&widget_id=$WA2")" | jq '[.data[].count] | add')"
# Bad day counts are rejected
expect_equal "days=0 gives 400" "400" "$(code_of "$(dash "$TOKEN_A" '/stats/over-time?days=0')")"
# Too many days
expect_equal "days=366 gives 400" "400" "$(code_of "$(dash "$TOKEN_A" '/stats/over-time?days=366')")"
# The default window is 30 days
expect_equal "default window is 30 days" "30" "$(body_of "$(dash "$TOKEN_A" '/stats/over-time')" | jq '.data | length')"

# Geo breakdown for owner A
RESP=$(dash "$TOKEN_A" '/stats/geo')
# Status
expect_equal "geo breakdown returns 200" "200" "$(code_of "$RESP")"
# Total covers all four submissions
expect_equal "geo total is 4" "4" "$(body_of "$RESP" | jq '.total')"
# Mockland A answered two submissions
expect_equal "Mockland A count" "2" "$(body_of "$RESP" | jq '[.data[] | select(.country=="Mockland A")][0].count')"
# Mockland B answered one
expect_equal "Mockland B count" "1" "$(body_of "$RESP" | jq '[.data[] | select(.country=="Mockland B")][0].count')"
# One submission had no geo data
expect_equal "Unknown count (no geo data)" "1" "$(body_of "$RESP" | jq '[.data[] | select(.country=="Unknown")][0].count')"
# Percentages are shares of the total
expect_equal "Mockland A is 50 percent" "50" "$(body_of "$RESP" | jq '[.data[] | select(.country=="Mockland A")][0].percent')"
# Largest group first
expect_equal "largest country is listed first" "Mockland A" "$(body_of "$RESP" | jq -r '.data[0].country')"
# Filtering to widget A2 leaves one submission
expect_equal "geo filtered to widget A2 has total 1" "1" "$(body_of "$(dash "$TOKEN_A" "/stats/geo?widget_id=$WA2")" | jq '.total')"
# A time window can be applied
expect_equal "geo with days=1 still counts today's 4" "4" "$(body_of "$(dash "$TOKEN_A" '/stats/geo?days=1')" | jq '.total')"
# Owner B sees only their own geo data
expect_equal "owner B's geo total is 2" "2" "$(body_of "$(dash "$TOKEN_B" '/stats/geo')" | jq '.total')"
# Bad day count
expect_equal "geo days=abc gives 400" "400" "$(code_of "$(dash "$TOKEN_A" '/stats/geo?days=abc')")"

# ------------------------------------------------------------------------------
# TEST SUITE 5: Probe 1 flow - a new submission shows up in the dashboard
# ------------------------------------------------------------------------------
echo ""
echo "[Test Suite 5] A new public submission becomes visible to its owner..."

# A visitor submits to owner A's widget 1
RESP=$(submit "$WA1" 198.51.100.67 "Probe one visitor")
# Stored with a 2xx status
expect_equal "visitor submission accepted" "201" "$(code_of "$RESP")"
# Its id
NEW_ID=$(body_of "$RESP" | jq -r '.submission_id')
# The newest item in owner A's dashboard is that submission
TOP=$(body_of "$(dash "$TOKEN_A" '/submissions?limit=1')" | jq -r '.data[0].id')
# They must match
expect_equal "the new submission is the newest item in the owner's dashboard" "$NEW_ID" "$TOP"
# And it is not visible to owner B
expect_equal "the new submission is hidden from owner B (404)" "404" "$(code_of "$(dash "$TOKEN_B" "/submissions/$NEW_ID")")"
# The counts moved by one
expect_equal "owner A's total is now 5" "5" "$(body_of "$(dash "$TOKEN_A" '/submissions')" | jq -r '.pagination.total')"

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
