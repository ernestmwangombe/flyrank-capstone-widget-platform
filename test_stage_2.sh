#!/bin/bash
# ==============================================================================
# FlyRank Capstone - Stage 2 Test Suite: Embed Snippet Generation
# ==============================================================================

# Target host server configuration
SERVER_URL="http://localhost:3000"

# Tenant authentication token for test isolated state
TOKEN="tenant_alpha_token_123"

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
if echo "$CREATE_RESPONSE" | grep -q "widget.js?id=$WIDGET_ID"; then
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