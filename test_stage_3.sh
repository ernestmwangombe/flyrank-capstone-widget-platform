#!/usr/bin/env bash
# ==============================================================================
# FlyRank Capstone - Stage 3 Public Delivery Integration Tests (test_stage_3.sh)
# Description: Automated test script verifying CORS, HTTP Caching, and status codes.
# ==============================================================================

# Define base URL target for local Express API server
BASE_URL="http://localhost:3000"

# Initialize global test counter variables for summary tracking
PASSED_TESTS=0
FAILED_TESTS=0

# Print visual test run header to terminal output
echo "======================================================================"
echo " Starting Stage 3: Public Delivery Integration Test Suite"
echo " Target API Server: $BASE_URL"
echo "======================================================================"

# Helper function to evaluate and assert expected vs actual test results
# Arguments: $1 = Test Description, $2 = Expected Result, $3 = Actual Result
assert_equals() {
  local test_name="$1"
  local expected="$2"
  local actual="$3"

  # Compare expected value against actual returned value
  if [ "$expected" == "$actual" ]; then
    echo "  ✅ PASS: $test_name (Value: $actual)"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    echo "  ❌ FAIL: $test_name (Expected: '$expected', Got: '$actual')"
    FAILED_TESTS=$((FAILED_TESTS + 1))
  fi
}

# ==============================================================================
# TEST SUITE 1: Public Script Runner Delivery (GET /widget.js)
# ==============================================================================
echo ""
echo "[Test Suite 1] Verifying GET /widget.js (Static Loader Bundle)..."

# Execute curl request silently (-s), discard response body (-o /dev/null), and print HTTP response code (-w "%{http_code}")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/widget.js")
# Assert that the static script loader delivers HTTP status 200 OK
assert_equals "GET /widget.js HTTP Status Code" "200" "$HTTP_CODE"

# Execute curl head request (-I), filter Content-Type header (grep), extract value (awk), and strip carriage returns (tr)
CONTENT_TYPE=$(curl -s -I "$BASE_URL/widget.js" | grep -i "content-type" | awk -F': ' '{print $2}' | tr -d '\r')
# Assert that Content-Type header specifies JavaScript MIME type with UTF-8 encoding
assert_equals "GET /widget.js Content-Type Header" "application/javascript; charset=utf-8" "$CONTENT_TYPE"

# Extract Cache-Control header from response headers
CACHE_HEADER=$(curl -s -I "$BASE_URL/widget.js" | grep -i "cache-control" | awk -F': ' '{print $2}' | tr -d '\r')
# Assert long-term immutable caching policy (31536000 seconds / 1 year)
assert_equals "GET /widget.js Long-Term Cache-Control" "public, max-age=31536000, immutable" "$CACHE_HEADER"


# ==============================================================================
# TEST SUITE 2: Valid Public Configuration Delivery (GET /api/widgets/1/config)
# ==============================================================================
echo ""
echo "[Test Suite 2] Verifying GET /api/widgets/1/config (Valid Seeded Widget)..."

# Fetch HTTP status code for existing widget ID 1
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/widgets/1/config")
# Assert that fetching seeded widget config returns HTTP 200 OK
assert_equals "GET /api/widgets/1/config HTTP Status Code" "200" "$HTTP_CODE"

# Extract Access-Control-Allow-Origin header to verify public CORS support
CORS_HEADER=$(curl -s -I "$BASE_URL/api/widgets/1/config" | grep -i "access-control-allow-origin" | awk -F': ' '{print $2}' | tr -d '\r')
# Assert that CORS origin header allows embedding on any external domain (*)
assert_equals "GET /api/widgets/1/config Access-Control-Allow-Origin" "*" "$CORS_HEADER"

# Extract Cache-Control header from config endpoint response
CACHE_HEADER=$(curl -s -I "$BASE_URL/api/widgets/1/config" | grep -i "cache-control" | awk -F': ' '{print $2}' | tr -d '\r')
# Assert short-term edge caching policy (60 seconds)
assert_equals "GET /api/widgets/1/config Short-Term Cache-Control" "public, max-age=60" "$CACHE_HEADER"


# ==============================================================================
# TEST SUITE 3: Non-Existent Widget Error Handling (GET /api/widgets/99999/config)
# ==============================================================================
echo ""
echo "[Test Suite 3] Verifying GET /api/widgets/99999/config (Missing Widget)..."

# Fetch HTTP status code for non-existent widget ID 99999
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/widgets/99999/config")
# Assert that missing resource returns HTTP 404 Not Found
assert_equals "GET /api/widgets/99999/config HTTP Status Code" "404" "$HTTP_CODE"

# Extract Cache-Control header for missing resource response
NO_CACHE_HEADER=$(curl -s -I "$BASE_URL/api/widgets/99999/config" | grep -i "cache-control" | awk -F': ' '{print $2}' | tr -d '\r')
# Assert that failure states explicitly disable proxy caching (no-store)
assert_equals "404 Not Found Cache-Control Header" "no-store" "$NO_CACHE_HEADER"


# ==============================================================================
# TEST SUITE 4: Invalid Parameter Format Error Handling (GET /api/widgets/abc/config)
# ==============================================================================
echo ""
echo "[Test Suite 4] Verifying GET /api/widgets/abc/config (Invalid Parameter)..."

# Fetch HTTP status code for non-integer route parameter "abc"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/widgets/abc/config")
# Assert that non-numeric parameter validation returns HTTP 400 Bad Request
assert_equals "GET /api/widgets/abc/config HTTP Status Code" "400" "$HTTP_CODE"


# ==============================================================================
# TEST SUITE SUMMARY & EXIT STATUS
# ==============================================================================
echo ""
echo "======================================================================"
echo " Test Execution Summary: $PASSED_TESTS Passed, $FAILED_TESTS Failed"
echo "======================================================================"

# Return exit code 0 if all tests passed, otherwise return exit code 1 for CI build failure
if [ $FAILED_TESTS -gt 0 ]; then
  exit 1
else
  exit 0
fi