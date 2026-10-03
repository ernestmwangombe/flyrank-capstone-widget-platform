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
# Send the file as the request body (--data-binary @file)
# FIX: capture the HTTP status code AND the response content type (separated by a space) so we can also check the body is JSON
OVERSIZED_RESULT=$(curl -s -o /dev/null -w "%{http_code} %{content_type}" -X POST "$TARGET_URL" \
  -H "Content-Type: application/json" \
  --data-binary @"$TMP_BODY")
# Delete the temporary file now that the request is done
rm -f "$TMP_BODY"
# FIX: split the result: everything before the first space is the status code
OVERSIZED_STATUS="${OVERSIZED_RESULT%% *}"
# FIX: split the result: everything after the first space is the content type
OVERSIZED_TYPE="${OVERSIZED_RESULT#* }"

# FIX: the check now requires BOTH status 413 and a JSON content type (not Express's HTML error page)
if [ "$OVERSIZED_STATUS" -eq 413 ] && [[ "$OVERSIZED_TYPE" == application/json* ]]; then
  # Report success including the content type that was returned
  echo "PASS (HTTP 413, $OVERSIZED_TYPE)"
else
  # Report what was actually received so the failure is easy to diagnose
  echo "FAIL (Expected HTTP 413 with application/json, got HTTP $OVERSIZED_STATUS, $OVERSIZED_TYPE)"
  # Stop the script with a failure code
  exit 1
fi

# Test 6: Reject Malformed JSON with a clean JSON 400 (not an HTML error page)
# Print the test label without a trailing newline so PASS/FAIL lands on the same line
echo -n "[Test 6] Rejecting Malformed JSON (Expect 400 JSON)... "
# Send a body with a missing closing brace and capture "status content-type" in one string
MALFORMED_RESULT=$(curl -s -o /tmp/test4_malformed_body.txt -w "%{http_code} %{content_type}" -X POST "$TARGET_URL" \
  -H "Content-Type: application/json" \
  -d '{"widget_id": 1, "data": {"email": ')
# Everything before the first space is the HTTP status code
MALFORMED_STATUS="${MALFORMED_RESULT%% *}"
# Everything after the first space is the content type
MALFORMED_TYPE="${MALFORMED_RESULT#* }"
# Read the response body so we can confirm it has the standard "error" field
MALFORMED_BODY=$(cat /tmp/test4_malformed_body.txt)
# Remove the temporary body file
rm -f /tmp/test4_malformed_body.txt

# Pass only when the status is 400, the type is JSON and the body contains an "error" field
if [ "$MALFORMED_STATUS" -eq 400 ] && [[ "$MALFORMED_TYPE" == application/json* ]] && [[ "$MALFORMED_BODY" == *'"error"'* ]]; then
  # Report success with the status code
  echo "PASS (HTTP 400, JSON)"
else
  # Report what was actually received so the failure is easy to diagnose
  echo "FAIL (Expected HTTP 400 JSON, got HTTP $MALFORMED_STATUS, $MALFORMED_TYPE, body: $MALFORMED_BODY)"
  # Stop the script with a failure code
  exit 1
fi

# Test 7: Unknown route returns a JSON 404 (not an HTML error page)
# Print the test label without a trailing newline so PASS/FAIL lands on the same line
echo -n "[Test 7] Unknown Route (Expect 404 JSON)... "
# Request a path that does not exist and capture "status content-type" in one string
UNKNOWN_RESULT=$(curl -s -o /dev/null -w "%{http_code} %{content_type}" "http://localhost:3000/api/does-not-exist")
# Everything before the first space is the HTTP status code
UNKNOWN_STATUS="${UNKNOWN_RESULT%% *}"
# Everything after the first space is the content type
UNKNOWN_TYPE="${UNKNOWN_RESULT#* }"

# Pass only when the status is 404 and the content type is JSON
if [ "$UNKNOWN_STATUS" -eq 404 ] && [[ "$UNKNOWN_TYPE" == application/json* ]]; then
  # Report success with the status code
  echo "PASS (HTTP 404, JSON)"
else
  # Report what was actually received so the failure is easy to diagnose
  echo "FAIL (Expected HTTP 404 JSON, got HTTP $UNKNOWN_STATUS, $UNKNOWN_TYPE)"
  # Stop the script with a failure code
  exit 1
fi

echo "=================================================="
echo "STAGE 4 VERIFICATION COMPLETE: ALL CHECKS PASSED!"
echo "=================================================="