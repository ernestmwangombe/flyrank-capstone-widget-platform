#!/usr/bin/env bash
# ==============================================================================
# File: test_stage_1.sh
# Purpose: End-to-End API Integration & Multi-Tenant Isolation Test Suite
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

# ------------------------------------------------------------------------------
# TEST 1: Register Tenant A
# ------------------------------------------------------------------------------
echo -e "\n1. Registering Tenant A..."
# Generate a unique email using the current epoch timestamp to avoid DB duplicate key conflicts
REGISTER_A_PAYLOAD='{"email":"tenant_a_'$(date +%s)'@example.com","password":"password123","company_name":"Tenant A Corp"}'

# Send HTTP POST request to register endpoint; write full output and append HTTP status code on a new line
RESP_A=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "$REGISTER_A_PAYLOAD")

# Extract the HTTP status code from the last line of the response
STATUS_A=$(echo "$RESP_A" | tail -n1)

# Extract the JSON response body by dropping the last line (the HTTP status code)
BODY_A=$(echo "$RESP_A" | sed '$d')

# Assert that registration returned HTTP 201 Created
assert_status 201 "$STATUS_A" "Tenant A Registration"


# ------------------------------------------------------------------------------
# TEST 2: Authenticate Tenant A & Extract JWT Token
# ------------------------------------------------------------------------------
echo -e "\n2. Logging in Tenant A..."
# Parse out the registered email string from the payload variable
EMAIL_A=$(echo "$REGISTER_A_PAYLOAD" | grep -o '"email":"[^"]*' | grep -o '[^"]*$')
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
TOKEN_A=$(echo "$BODY_LOGIN_A" | grep -o '"token":"[^"]*' | grep -o '[^"]*$')

# Ensure the token string was successfully parsed before proceeding
if [ -z "$TOKEN_A" ]; then
    echo -e "${RED}[FAIL]${NC} Failed to extract JWT token for Tenant A"
    exit 1
fi


# ------------------------------------------------------------------------------
# TEST 3: Create Widget as Authenticated Tenant A
# ------------------------------------------------------------------------------
echo -e "\n3. Creating Widget as Tenant A..."
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
# TEST 4: Retrieve Widgets Owned by Tenant A
# ------------------------------------------------------------------------------
echo -e "\n4. Fetching Widgets for Tenant A..."
# Send HTTP GET request with Tenant A's JWT token
RESP_GET_A=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/widgets" \
  -H "Authorization: Bearer $TOKEN_A")

STATUS_GET_A=$(echo "$RESP_GET_A" | tail -n1)

# Assert that fetching tenant widgets returned HTTP 200 OK
assert_status 200 "$STATUS_GET_A" "Fetch Widgets (Tenant A)"


# ------------------------------------------------------------------------------
# TEST 5: Register & Authenticate a Second Tenant (Tenant B)
# ------------------------------------------------------------------------------
echo -e "\n5. Registering & Logging in Tenant B..."
REGISTER_B_PAYLOAD='{"email":"tenant_b_'$(date +%s)'@example.com","password":"password123","company_name":"Tenant B Corp"}'

# Silently register Tenant B
curl -s -X POST "$BASE_URL/api/auth/register" -H "Content-Type: application/json" -d "$REGISTER_B_PAYLOAD" > /dev/null

EMAIL_B=$(echo "$REGISTER_B_PAYLOAD" | grep -o '"email":"[^"]*' | grep -o '[^"]*$')
LOGIN_B_PAYLOAD="{\"email\":\"$EMAIL_B\",\"password\":\"password123\"}"

# Authenticate Tenant B and parse Tenant B's unique JWT token
RESP_LOGIN_B=$(curl -s -X POST "$BASE_URL/api/auth/login" -H "Content-Type: application/json" -d "$LOGIN_B_PAYLOAD")
TOKEN_B=$(echo "$RESP_LOGIN_B" | grep -o '"token":"[^"]*' | grep -o '[^"]*$')


# ------------------------------------------------------------------------------
# TEST 6: Verify Multi-Tenant Isolation Boundaries
# ------------------------------------------------------------------------------
echo -e "\n6. Testing Multi-Tenant Isolation (Tenant B accessing Tenant A's Widget)..."
# Attempt to fetch Tenant A's widget using Tenant B's JWT token
RESP_ISOLATION=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/api/widgets/$WIDGET_ID" \
  -H "Authorization: Bearer $TOKEN_B")

STATUS_ISOLATION=$(echo "$RESP_ISOLATION" | tail -n1)

# Multi-tenant isolation passes ONLY if the request is rejected with 404 (Not Found) or 403 (Forbidden)
if [ "$STATUS_ISOLATION" -eq 404 ] || [ "$STATUS_ISOLATION" -eq 403 ]; then
    echo -e "${GREEN}[PASS]${NC} Multi-Tenant Isolation Verified (Tenant B rejected with status $STATUS_ISOLATION)"
else
    echo -e "${RED}[FAIL]${NC} Multi-Tenant Isolation Failed! Tenant B accessed Tenant A's widget (Status: $STATUS_ISOLATION)"
    exit 1
fi


# ------------------------------------------------------------------------------
# TEST 7: Clean Up & Delete Widget as Tenant A
# ------------------------------------------------------------------------------
echo -e "\n7. Deleting Widget as Tenant A..."
# Send HTTP DELETE request authorized as Tenant A to remove the test resource
RESP_DELETE=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/api/widgets/$WIDGET_ID" \
  -H "Authorization: Bearer $TOKEN_A")

STATUS_DELETE=$(echo "$RESP_DELETE" | tail -n1)

# Assert that widget deletion returned HTTP 200 OK
assert_status 200 "$STATUS_DELETE" "Delete Widget (Tenant A)"

echo -e "\n=================================================="
echo -e "${GREEN}ALL STAGE 1 TESTS PASSED SUCCESSFULLY!${NC}"
echo "=================================================="