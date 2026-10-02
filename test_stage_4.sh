#!/usr/bin/env bash
# Enforce strict script execution: stop on error, unset variable, or failed pipe
set -euo pipefail

# Define public submission target endpoint URL
TARGET_URL="http://localhost:3000/api/embed/submit"

echo "=================================================="
echo "RUNNING STAGE 4 VERIFICATION: Public Submission Endpoint"
echo "=================================================="

# Test 1: Verify CORS Preflight (OPTIONS Request)
echo -n "[Test 1] Testing CORS OPTIONS Preflight... "
PREFLIGHT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$TARGET_URL" \
  -H "Origin: https://client-website.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type")

if [ "$PREFLIGHT_STATUS" -eq 204 ] || [ "$PREFLIGHT_STATUS" -eq 200 ]; then
  echo "PASS (HTTP $PREFLIGHT_STATUS)"
else
  echo "FAIL (Expected HTTP 204/200, got HTTP $PREFLIGHT_STATUS)"
  exit 1
fi

# Test 2: Verify Valid Submission Ingestion (POST Request)
echo -n "[Test 2] Submitting Valid Payload (Expect 201)... "
VALID_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$TARGET_URL" \
  -H "Content-Type: application/json" \
  -H "Origin: https://client-website.com" \
  -d '{"widget_id": 1, "data": {"email": "ernest@example.com", "feedback": "Great platform!"}}')

if [ "$VALID_STATUS" -eq 201 ]; then
  echo "PASS (HTTP 201)"
else
  echo "FAIL (Expected HTTP 201, got HTTP $VALID_STATUS)"
  exit 1
fi

# Test 3: Reject Missing Required Field (Expect 400 Bad Request)
echo -n "[Test 3] Rejecting Missing Required Fields (Expect 400)... "
INVALID_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$TARGET_URL" \
  -H "Content-Type: application/json" \
  -d '{"widget_id": 1}') # Missing required 'data' field

if [ "$INVALID_STATUS" -eq 400 ]; then
  echo "PASS (HTTP 400)"
else
  echo "FAIL (Expected HTTP 400, got HTTP $INVALID_STATUS)"
  exit 1
fi

# Test 4: Reject Non-Existent Target Widget (Expect 404 Not Found)
echo -n "[Test 4] Submitting to Non-Existent Widget (Expect 404)... "
MISSING_WIDGET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$TARGET_URL" \
  -H "Content-Type: application/json" \
  -d '{"widget_id": 99999, "data": {"email": "test@example.com"}}')

if [ "$MISSING_WIDGET_STATUS" -eq 404 ]; then
  echo "PASS (HTTP 404)"
else
  echo "FAIL (Expected HTTP 404, got HTTP $MISSING_WIDGET_STATUS)"
  exit 1
fi

# Test 5: Reject Oversized Payload Boundary Breach (Expect 413 Payload Too Large)
echo -n "[Test 5] Rejecting Oversized Payload > 100kb (Expect 413)... "
# FIX: a ~105 KB value is too long to pass as a curl command-line argument on Windows Git Bash ("Argument list too long").
# This version writes the JSON body to a temporary file and tells curl to read the body from that file instead.
# Create an empty temporary file to hold the oversized request body
TMP_BODY=$(mktemp)
# Build the JSON in the file: opening part, then exactly 105000 'a' characters (head reads a fixed size, so pipefail stays happy), then closing part
{ printf '{"widget_id": 1, "data": {"large_string": "'; head -c 105000 /dev/zero | tr '\0' 'a'; printf '"}}'; } > "$TMP_BODY"
# Send the file as the request body (--data-binary @file) and capture only the HTTP status code
OVERSIZED_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$TARGET_URL" \
  -H "Content-Type: application/json" \
  --data-binary @"$TMP_BODY")
# Delete the temporary file now that the request is done
rm -f "$TMP_BODY"

if [ "$OVERSIZED_STATUS" -eq 413 ]; then
  echo "PASS (HTTP 413)"
else
  echo "FAIL (Expected HTTP 413, got HTTP $OVERSIZED_STATUS)"
  exit 1
fi

echo "=================================================="
echo "STAGE 4 VERIFICATION COMPLETE: ALL CHECKS PASSED!"
echo "=================================================="