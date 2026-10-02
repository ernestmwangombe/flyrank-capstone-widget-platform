#!/bin/bash
# ==============================================================================
# FlyRank Capstone - Stage 2 Test Suite: Embed Snippet Generation
# ==============================================================================

# Target host server configuration
SERVER_URL="http://localhost:3000"

# FIX: the server now only accepts real JWTs, so this test registers a fresh tenant and logs in to get one
STAMP=$(date +%s)

# Unique email so repeated test runs never collide
EMAIL="stage2_${STAMP}@example.com"

# Register the test tenant (output discarded; the login below proves it worked)
curl -s -o /dev/null -X POST "$SERVER_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"password123\",\"company_name\":\"Stage 2 Corp\"}"

# Log in and extract the signed JWT from the JSON response
TOKEN=$(curl -s -X POST "$SERVER_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}" | jq -r '.token')

# Stop early with a clear message if no token came back
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "FAIL: could not obtain a JWT from /api/auth/login."
  exit 1
fi

echo "=========================================================="
echo "RUNNING STAGE 2 VERIFICATION: Embed Snippet Generation"
echo "=========================================================="

# Step 1: Create a Widget and test POST response
echo -e "\n[Test 1] Creating widget and verifying embed_snippet in response..."
CREATE_RESPONSE=$(curl -s -X POST "$SERVER_URL/api/widgets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Stage 2 Lead Form",
    "type": "signup_form",
    "config": {
      "title": "Subscribe to Newsletter",
      "buttonText": "Submit"
    }
  }')

echo "Response: $CREATE_RESPONSE"

# Assert presence of embed_snippet field in JSON output
if echo "$CREATE_RESPONSE" | grep -q "embed_snippet"; then
    echo "PASS: 'embed_snippet' field exists in POST response."
else
    echo "FAIL: 'embed_snippet' field missing from POST response."
    exit 1
fi

# Step 2: Extract Widget ID and verify script tag structure
WIDGET_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":[^,}]*' | awk -F':' '{print $2}' | tr -d ' "')
echo "Extracted Widget ID: $WIDGET_ID"

# Assert script tag query string contains correct ID
# FIX (Stage 3): the snippet now uses a versioned bundle URL such as widget.v1.js, so match widget.v<number>.js?id=<id>
if echo "$CREATE_RESPONSE" | grep -Eq "widget\.v[0-9]+\.js\?id=$WIDGET_ID"; then
    echo "PASS: Snippet script tag correctly binds Widget ID ($WIDGET_ID)."
else
    echo "FAIL: Snippet script tag does not contain expected script URL format."
    exit 1
fi

# Step 3: Test GET /api/widgets/:id consistency
echo -e "\n[Test 2] Fetching widget by ID ($WIDGET_ID) to verify GET consistency..."
GET_RESPONSE=$(curl -s -X GET "$SERVER_URL/api/widgets/$WIDGET_ID" \
  -H "Authorization: Bearer $TOKEN")

if echo "$GET_RESPONSE" | grep -q "embed_snippet"; then
    echo "PASS: 'embed_snippet' present in GET /api/widgets/:id response."
else
    echo "FAIL: 'embed_snippet' missing in GET /api/widgets/:id response."
    exit 1
fi

echo -e "\n=========================================================="
echo "STAGE 2 VERIFICATION COMPLETE: ALL CHECKS PASSED!"
echo "=========================================================="