#!/usr/bin/env bash
# ==============================================================================
# File: test_stage_1.sh
# Purpose: End-to-End API Integration & Multi-Tenant Isolation Test Suite
# FIX: extended with auth rejection, PUT, duplicate/wrong-password checks and cross-tenant PUT/DELETE attacks
# ==============================================================================

# Define the base target URL for the local Node.js Express server
BASE_URL="http://localhost:3000"

# Define ANSI color escape codes for terminal status output formatting
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color (resets terminal text color back to default)

echo "=================================================="
echo "Starting Stage 1 Test Suite against $BASE_URL"
echo "=================================================="

# Function: assert_status
# Parameters: $1 = expected_status_code, $2 = actual_status_code, $3 = test_description
# Purpose: Evaluates HTTP response codes and halts execution if an assertion fails.
assert_status() {
    local expected="$1"
    local actual="$2"
    local test_name="$3"

    # Compare expected status code against the actual HTTP response code
    if [ "$expected" -eq "$actual" ]; then
        echo -e "${GREEN}[PASS]${NC} $test_name (Status: $actual)"
    else
        echo -e "${RED}[FAIL]${NC} $test_name (Expected: $expected, Got: $actual)"
        exit 1 # Terminate the script immediately on test failure
    fi
}

# Use one timestamp for all generated emails so reruns never collide with earlier runs
STAMP=$(date +%s)

# ------------------------------------------------------------------------------
# TEST 1: Register Tenant A
# ------------------------------------------------------------------------------
echo -e "\n1. Registering Tenant A..."
# Build the registration payload with a unique email
EMAIL_A="tenant_a_${STAMP}@example.com"
REGISTER_A_PAYLOAD="{\"email\":\"$EMAIL_A\",\"password\":\"password123\",\"company_name\":\"Tenant A Corp\"}"

# Send HTTP POST request to register endpoint; write full output and append HTTP status code on a new line
RESP_A=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "$REGISTER_A_PAYLOAD")

# Extract the HTTP status code from the last line of the response
STATUS_A=$(echo "$RESP_A" | tail -n1)

# Assert that registration returned HTTP 201 Created
assert_status 201 "$STATUS_A" "Tenant A Registration"

# FIX: registering the same email again must be rejected with 409 Conflict
STATUS_DUP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "$REGISTER_A_PAYLOAD")
assert_status 409 "$STATUS_DUP" "Duplicate Registration Rejected"

# FIX: a too-short password must be rejected with 400 Bad Request
STATUS_WEAK=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"weak_${STAMP}@example.com\",\"password\":\"short\",\"company_name\":\"Weak Corp\"}")
assert_status 400 "$STATUS_WEAK" "Short Password Rejected"


# ------------------------------------------------------------------------------
# TEST 2: Authenticate Tenant A & Extract JWT Token
# ------------------------------------------------------------------------------
echo -e "\n2. Logging in Tenant A..."
# Build the login payload for Tenant A
LOGIN_A_PAYLOAD="{\"email\":\"$EMAIL_A\",\"password\":\"password123\"}"

# Send HTTP POST request to login endpoint
RESP_LOGIN_A=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "$LOGIN_A_PAYLOAD")

# Extract HTTP status code and response body
STATUS_LOGIN_A=$(echo "$RESP_LOGIN_A" | tail -n1)
BODY_LOGIN_A=$(echo "$RESP_LOGIN_A" | sed '$d')

# Assert that login returned HTTP 200 OK
assert_status 200 "$STATUS_LOGIN_A" "Tenant A Login"

# Parse the Bearer JWT token string from the JSON login response body
TOKEN_A=$(echo "$BODY_LOGIN_A" | jq -r '.token')

# Ensure the token string was successfully parsed before proceeding
if [ -z "$TOKEN_A" ] || [ "$TOKEN_A" = "null" ]; then
    echo -e "${RED}[FAIL]${NC} Failed to extract JWT token for Tenant A"
    exit 1
fi

# FIX: a wrong password must be rejected with 401 Unauthorized
STATUS_BADPW=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL_A\",\"password\":\"wrong-password\"}")
assert_status 401 "$STATUS_BADPW" "Wrong Password Rejected"


# ------------------------------------------------------------------------------
# TEST 3: Reject Requests Without Valid Auth
# ------------------------------------------------------------------------------
echo -e "\n3. Testing that invalid authentication is rejected..."
# FIX: no Authorization header at all must return 401
STATUS_NOAUTH=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/widgets")
assert_status 401 "$STATUS_NOAUTH" "No Authorization Header Rejected"

# FIX: the old mock auth accepted any string as a tenant id; a made-up token must now return 401
STATUS_FORGED=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/widgets" \
  -H "Authorization: Bearer tenant_alpha_token_123")
assert_status 401 "$STATUS_FORGED" "Made-Up Bearer String Rejected"

# FIX: the old x-tenant-id header must no longer grant access
STATUS_HEADER=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/widgets" \
  -H "x-tenant-id: 1")
assert_status 401 "$STATUS_HEADER" "x-tenant-id Header Rejected"

# FIX: a real token with its last character changed breaks the signature and must return 401
TAMPERED_TOKEN="${TOKEN_A%?}X"
STATUS_TAMPER=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/widgets" \
  -H "Authorization: Bearer $TAMPERED_TOKEN")
assert_status 401 "$STATUS_TAMPER" "Tampered Token Rejected"


# ------------------------------------------------------------------------------
# TEST 4: Create Widget as Authenticated Tenant A
# ------------------------------------------------------------------------------
echo -e "\n4. Creating Widget as Tenant A..."
WIDGET_PAYLOAD='{"name":"Lead Capture Modal","config":{"theme":"dark","fields":["name","email"]}}'

# Send HTTP POST request with Authorization Bearer header to create a new widget
RESP_WIDGET=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/widgets" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_A" \
  -d "$WIDGET_PAYLOAD")

# Extract status code and response body
STATUS_WIDGET=$(echo "$RESP_WIDGET" | tail -n1)
BODY_WIDGET=$(echo "$RESP_WIDGET" | sed '$d')

# Assert that widget creation returned HTTP 201 Created
assert_status 201 "$STATUS_WIDGET" "Create Widget (Tenant A)"

# Parse the generated widget ID string from the returned JSON object
WIDGET_ID=$(echo "$BODY_WIDGET" | jq -r '.id')
if [ -z "$WIDGET_ID" ] || [ "$WIDGET_ID" = "null" ]; then
    echo -e "${RED}[FAIL]${NC} Failed to extract Widget ID for Tenant A"
    exit 1
fi


# ------------------------------------------------------------------------------
# TEST 5: Retrieve and Update Widgets Owned by Tenant A
# ------------------------------------------------------------------------------
echo -e "\n5. Fetching and updating Widgets for Tenant A..."
# Send HTTP GET request with Tenant A's JWT token
STATUS_GET_A=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/widgets" \
  -H "Authorization: Bearer $TOKEN_A")

# Assert that fetching tenant widgets returned HTTP 200 OK
assert_status 200 "$STATUS_GET_A" "Fetch Widgets (Tenant A)"

# FIX: update the widget name with PUT and confirm the new name comes back
RESP_PUT=$(curl -s -w "\n%{http_code}" -X PUT "$BASE_URL/api/widgets/$WIDGET_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_A" \
  -d '{"name":"Renamed By Tenant A"}')
STATUS_PUT=$(echo "$RESP_PUT" | tail -n1)
BODY_PUT=$(echo "$RESP_PUT" | sed '$d')
assert_status 200 "$STATUS_PUT" "Update Widget (Tenant A)"

# Confirm the response really contains the new name
NEW_NAME=$(echo "$BODY_PUT" | jq -r '.name')
if [ "$NEW_NAME" = "Renamed By Tenant A" ]; then
    echo -e "${GREEN}[PASS]${NC} Updated name is returned (Name: $NEW_NAME)"
else
    echo -e "${RED}[FAIL]${NC} Updated name missing (Got: $NEW_NAME)"
    exit 1
fi


# ------------------------------------------------------------------------------
# TEST 6: Register & Authenticate a Second Tenant (Tenant B)
# ------------------------------------------------------------------------------
echo -e "\n6. Registering & Logging in Tenant B..."
EMAIL_B="tenant_b_${STAMP}@example.com"
REGISTER_B_PAYLOAD="{\"email\":\"$EMAIL_B\",\"password\":\"password123\",\"company_name\":\"Tenant B Corp\"}"

# Silently register Tenant B
curl -s -X POST "$BASE_URL/api/auth/register" -H "Content-Type: application/json" -d "$REGISTER_B_PAYLOAD" > /dev/null

LOGIN_B_PAYLOAD="{\"email\":\"$EMAIL_B\",\"password\":\"password123\"}"

# Authenticate Tenant B and parse Tenant B's unique JWT token
RESP_LOGIN_B=$(curl -s -X POST "$BASE_URL/api/auth/login" -H "Content-Type: application/json" -d "$LOGIN_B_PAYLOAD")
TOKEN_B=$(echo "$RESP_LOGIN_B" | jq -r '.token')

# Stop if Tenant B has no token, because the isolation tests below would be meaningless
if [ -z "$TOKEN_B" ] || [ "$TOKEN_B" = "null" ]; then
    echo -e "${RED}[FAIL]${NC} Failed to extract JWT token for Tenant B"
    exit 1
fi


# ------------------------------------------------------------------------------
# TEST 7: Verify Multi-Tenant Isolation Boundaries
# ------------------------------------------------------------------------------
echo -e "\n7. Testing Multi-Tenant Isolation (Tenant B attacking Tenant A's Widget)..."
# Attempt to fetch Tenant A's widget using Tenant B's JWT token
STATUS_ISOLATION=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/widgets/$WIDGET_ID" \
  -H "Authorization: Bearer $TOKEN_B")

# Multi-tenant isolation passes ONLY if the request is rejected with 404 (Not Found) or 403 (Forbidden)
if [ "$STATUS_ISOLATION" -eq 404 ] || [ "$STATUS_ISOLATION" -eq 403 ]; then
    echo -e "${GREEN}[PASS]${NC} Tenant B cannot READ Tenant A's widget (Status: $STATUS_ISOLATION)"
else
    echo -e "${RED}[FAIL]${NC} Isolation Failed! Tenant B read Tenant A's widget (Status: $STATUS_ISOLATION)"
    exit 1
fi

# FIX: Tenant B must not be able to UPDATE Tenant A's widget
STATUS_B_PUT=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE_URL/api/widgets/$WIDGET_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_B" \
  -d '{"name":"Hijacked By Tenant B"}')
if [ "$STATUS_B_PUT" -eq 404 ] || [ "$STATUS_B_PUT" -eq 403 ]; then
    echo -e "${GREEN}[PASS]${NC} Tenant B cannot UPDATE Tenant A's widget (Status: $STATUS_B_PUT)"
else
    echo -e "${RED}[FAIL]${NC} Isolation Failed! Tenant B updated Tenant A's widget (Status: $STATUS_B_PUT)"
    exit 1
fi

# FIX: Tenant B must not be able to DELETE Tenant A's widget
STATUS_B_DEL=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/widgets/$WIDGET_ID" \
  -H "Authorization: Bearer $TOKEN_B")
if [ "$STATUS_B_DEL" -eq 404 ] || [ "$STATUS_B_DEL" -eq 403 ]; then
    echo -e "${GREEN}[PASS]${NC} Tenant B cannot DELETE Tenant A's widget (Status: $STATUS_B_DEL)"
else
    echo -e "${RED}[FAIL]${NC} Isolation Failed! Tenant B deleted Tenant A's widget (Status: $STATUS_B_DEL)"
    exit 1
fi

# FIX: after both attacks the widget must still exist with Tenant A's name
NAME_AFTER=$(curl -s -X GET "$BASE_URL/api/widgets/$WIDGET_ID" -H "Authorization: Bearer $TOKEN_A" | jq -r '.name')
if [ "$NAME_AFTER" = "Renamed By Tenant A" ]; then
    echo -e "${GREEN}[PASS]${NC} Widget survived Tenant B's attacks unchanged (Name: $NAME_AFTER)"
else
    echo -e "${RED}[FAIL]${NC} Widget was altered or removed by Tenant B (Name: $NAME_AFTER)"
    exit 1
fi


# ------------------------------------------------------------------------------
# TEST 8: Clean Up & Delete Widget as Tenant A
# ------------------------------------------------------------------------------
echo -e "\n8. Deleting Widget as Tenant A..."
# Send HTTP DELETE request authorized as Tenant A to remove the test resource
STATUS_DELETE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/widgets/$WIDGET_ID" \
  -H "Authorization: Bearer $TOKEN_A")

# Assert that widget deletion returned HTTP 200 OK
assert_status 200 "$STATUS_DELETE" "Delete Widget (Tenant A)"

# FIX: fetching the deleted widget must now return 404
STATUS_GONE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL/api/widgets/$WIDGET_ID" \
  -H "Authorization: Bearer $TOKEN_A")
assert_status 404 "$STATUS_GONE" "Deleted Widget Is Gone"

echo -e "\n=================================================="
echo -e "${GREEN}ALL STAGE 1 TESTS PASSED SUCCESSFULLY!${NC}"
echo "=================================================="
