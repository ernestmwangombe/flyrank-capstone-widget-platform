# FlyRank Capstone - Internship Evidence Log

---

## Stage 1 Verification: Widget Management API
- **Date:** September 4, 2026
- **Task:** CRUD API Operations & Data Persistence Verification (`./test_stage_1.sh`)
- **Status:** PASSED (All assertions verified)

### Execution Output
==========================================================
RUNNING STAGE 1 VERIFICATION: Widget Management API
==========================================================

| Test Case | Description / Operation | Result | Details |
| :--- | :--- | :--- | :--- |
| **Test 1** | Testing Database Connection & Schema | `PASS` | PostgreSQL database connection established. Database schema initialized successfully. |
| **Test 2** | Creating New Widget (`POST /api/widgets`) | `PASS` | HTTP status `201 Created` returned. Extracted Widget ID: `1`.<br>Response Payload: `{"id":1, "tenant_id":"tenant_alpha_token_123", "name":"Stage 1 Lead Form", "type":"signup_form", "config":{"title":"Subscribe"}, "created_at":"2026-09-04T00:45:10.112Z"}` |
| **Test 3** | Fetching Widget by ID (`GET /api/widgets/1`) | `PASS` | HTTP status `200 OK` returned. Returned record matches created widget ID. |
| **Test 4** | Updating Widget Configuration (`PUT /api/widgets/1`) | `PASS` | HTTP status `200 OK` returned. Widget config payload successfully updated. |
| **Test 5** | Fetching Non-Existent Widget (`GET /api/widgets/99999`) | `PASS` | HTTP status `404 Not Found` cleanly returned. |

==========================================================
STAGE 1 VERIFICATION COMPLETE: ALL CHECKS PASSED!
==========================================================

==========================================================
RUNNING STAGE 2 VERIFICATION: Embed Snippet Generation
==========================================================

### Stage 2 Verification: Embed Snippet Generation

| Test Case | Target Operation / Verification | Result | Details & Assertions |
| :--- | :--- | :--- | :--- |
| **Test 1** | Creating Widget & Verifying Embed Snippet (`POST /api/widgets`) | `PASS` | • `'embed_snippet'` field present in POST response payload.<br>• Extracted Widget ID: `1`.<br>• Snippet script tag correctly binds Widget ID (`1`).<br>• **Payload Snippet:** `<script src="http://localhost:3000/widget.js?id=1" defer></script>` |
| **Test 2** | Fetching Widget by ID (`GET /api/widgets/1`) | `PASS` | • Verified GET consistency.<br>• `'embed_snippet'` field present and correctly populated in GET response. |

==========================================================
STAGE 2 VERIFICATION COMPLETE: ALL CHECKS PASSED!
==========================================================

======================================================================
 Starting Stage 3: Public Delivery Integration Test Suite
 Target API Server: http://localhost:3000
======================================================================

### Stage 3: Public Delivery Integration Test Suite
**Target Server:** `http://localhost:3000`

| Test Suite | Target Endpoint & Context | Assertion / Header Verified | Expected Value | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Suite 1** | `GET /widget.js` (Static Loader Bundle) | HTTP Status Code | `200 OK` | `PASS` |
| | | Content-Type Header | `application/javascript; charset=utf-8` | `PASS` |
| | | Cache-Control Header | `public, max-age=31536000, immutable` | `PASS` |
| **Suite 2** | `GET /api/widgets/1/config` (Valid Seeded Widget) | HTTP Status Code | `200 OK` | `PASS` |
| | | Access-Control-Allow-Origin | `*` (CORS Enabled) | `PASS` |
| | | Cache-Control Header | `public, max-age=60` | `PASS` |
| **Suite 3** | `GET /api/widgets/99999/config` (Missing Widget) | HTTP Status Code | `404 Not Found` | `PASS` |
| | | Cache-Control Header | `no-store` | `PASS` |
| **Suite 4** | `GET /api/widgets/abc/config` (Invalid Parameter) | HTTP Status Code | `400 Bad Request` | `PASS` |

======================================================================
 Test Execution Summary: 9 Passed, 0 Failed
======================================================================