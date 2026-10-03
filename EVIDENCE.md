# FlyRank Capstone - Evidence Log

Every proof below is raw terminal output from a real run: Git Bash on Windows with Docker Desktop, started with `docker compose up --build`, against the PostgreSQL 15 container. Nothing is edited except that the shell prompt lines and Docker's "`version` is obsolete" warning were removed, and the output of each script is shown under its own heading.

**Run date:** 2026-10-02 for the seed step and Stages 1 to 3; Stage 4 was re-run afterwards, once the JSON error handler was added.
**Stages covered:** 1 to 4

The earlier version of this file was replaced. It predated the authentication fix, showed a mock token (`tenant_alpha_token_123`) and presented hand-formatted tables rather than raw output, so it no longer matched the code or the test scripts.

---

## Evidence index

| Requirement (brief, Section 6) | Proof in this file |
|---|---|
| Authenticated CRUD endpoints for widgets; requests without valid auth are rejected | [Stage 1](#stage-1-widget-management-api): sections 3, 4, 5 and 8 |
| Multi-tenant isolation (tenant A cannot read or modify tenant B's widgets) | [Stage 1](#stage-1-widget-management-api): section 7 |
| Embed snippet generated per widget | [Stage 2](#stage-2-embed-snippet-generation) |
| Public config endpoint with correct HTTP cache headers | [Stage 3](#stage-3-fast-cached-widget-delivery): Test Suites 2 to 4 |
| Widget JavaScript served as a versioned bundle | [Stage 3](#stage-3-fast-cached-widget-delivery): Test Suites 1 and 5 |
| Cross-origin submissions work; CORS and preflight handled | [Stage 4](#stage-4-public-submission-endpoint): Tests 1 and 2 |
| Input validated; malformed and oversized payloads rejected with 4xx and JSON errors | [Stage 4](#stage-4-public-submission-endpoint): Tests 3, 4, 5, 6 and 7 |
| Valid submissions stored safely, linked to the right widget and tenant | [Stage 4](#stage-4-public-submission-endpoint): Test 2 and the database query below it |

Note on isolation: the tenant isolation proof covers widgets (read, update, delete). The API has no endpoint that lists submissions yet, so isolation of submissions is not demonstrated here.

---

## Seed step

**Command** (the `seed:` line in `capstone.yaml`):

```
$ docker compose exec -T postgres psql -U postgres -d flyrank_db < schema.sql
DROP TABLE
DROP TABLE
DROP TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
INSERT 0 1
INSERT 0 1
 setval 
--------
      1
(1 row)

 setval 
--------
      1
(1 row)

CREATE INDEX
CREATE INDEX
CREATE INDEX
```

---

## Stage 1: Widget management API

**Command:** `bash test_stage_1.sh`
**Result:** every check passed (19 PASS lines, no FAIL).

```
==================================================
Starting Stage 1 Test Suite against http://localhost:3000
==================================================

1. Registering Tenant A...
[PASS] Tenant A Registration (Status: 201)
[PASS] Duplicate Registration Rejected (Status: 409)
[PASS] Short Password Rejected (Status: 400)

2. Logging in Tenant A...
[PASS] Tenant A Login (Status: 200)
[PASS] Wrong Password Rejected (Status: 401)

3. Testing that invalid authentication is rejected...
[PASS] No Authorization Header Rejected (Status: 401)
[PASS] Made-Up Bearer String Rejected (Status: 401)
[PASS] x-tenant-id Header Rejected (Status: 401)
[PASS] Tampered Token Rejected (Status: 401)

4. Creating Widget as Tenant A...
[PASS] Create Widget (Tenant A) (Status: 201)

5. Fetching and updating Widgets for Tenant A...
[PASS] Fetch Widgets (Tenant A) (Status: 200)
[PASS] Update Widget (Tenant A) (Status: 200)
[PASS] Updated name is returned (Name: Renamed By Tenant A)

6. Registering & Logging in Tenant B...

7. Testing Multi-Tenant Isolation (Tenant B attacking Tenant A's Widget)...
[PASS] Tenant B cannot READ Tenant A's widget (Status: 404)
[PASS] Tenant B cannot UPDATE Tenant A's widget (Status: 404)
[PASS] Tenant B cannot DELETE Tenant A's widget (Status: 404)
[PASS] Widget survived Tenant B's attacks unchanged (Name: Renamed By Tenant A)

8. Deleting Widget as Tenant A...
[PASS] Delete Widget (Tenant A) (Status: 200)
[PASS] Deleted Widget Is Gone (Status: 404)

==================================================
ALL STAGE 1 TESTS PASSED SUCCESSFULLY!
==================================================
```

---

## Stage 2: Embed snippet generation

**Command:** `bash test_stage_2.sh`
**Result:** all checks passed. The snippet points at the versioned bundle URL introduced in Stage 3.

```
==========================================================
RUNNING STAGE 2 VERIFICATION: Embed Snippet Generation
==========================================================

[Test 1] Creating widget and verifying embed_snippet in response...
Response: {"id":3,"tenant_id":5,"name":"Stage 2 Lead Form","type":"signup_form","config":{"title":"Subscribe to Newsletter","buttonText":"Submit"},"created_at":"2026-10-02T19:08:28.907Z","embed_snippet":"<script src=\"http://localhost:3000/widget.v1.js?id=3\" defer></script>"}
PASS: 'embed_snippet' field exists in POST response.
Extracted Widget ID: 3
PASS: Snippet script tag correctly binds Widget ID (3).

[Test 2] Fetching widget by ID (3) to verify GET consistency...
PASS: 'embed_snippet' present in GET /api/widgets/:id response.

==========================================================
STAGE 2 VERIFICATION COMPLETE: ALL CHECKS PASSED!
==========================================================
```

---

## Stage 3: Fast, cached widget delivery

**Command:** `bash test_stage_3.sh`
**Result:** 14 passed, 0 failed.

```
======================================================================
 Starting Stage 3: Public Delivery Integration Test Suite
 Target API Server: http://localhost:3000
======================================================================

[Test Suite 1] Verifying GET /widget.v1.js (Versioned Loader Bundle)...
  ✅ PASS: GET /widget.v1.js HTTP Status Code (Value: 200)
  ✅ PASS: GET /widget.v1.js Content-Type Header (Value: application/javascript; charset=utf-8)
  ✅ PASS: GET /widget.v1.js Long-Term Cache-Control (Value: public, max-age=31536000, immutable)

[Test Suite 2] Verifying GET /api/widgets/1/config (Valid Seeded Widget)...
  ✅ PASS: GET /api/widgets/1/config HTTP Status Code (Value: 200)
  ✅ PASS: GET /api/widgets/1/config Access-Control-Allow-Origin (Value: *)
  ✅ PASS: GET /api/widgets/1/config Short-Term Cache-Control (Value: public, max-age=60)

[Test Suite 3] Verifying GET /api/widgets/99999/config (Missing Widget)...
  ✅ PASS: GET /api/widgets/99999/config HTTP Status Code (Value: 404)
  ✅ PASS: 404 Not Found Cache-Control Header (Value: no-store)

[Test Suite 4] Verifying GET /api/widgets/abc/config (Invalid Parameter)...
  ✅ PASS: GET /api/widgets/abc/config HTTP Status Code (Value: 400)

[Test Suite 5] Verifying version safety...
  ✅ PASS: GET /widget.v999.js HTTP Status Code (Value: 404)
  ✅ PASS: GET /widget.v999.js Cache-Control Header (Value: no-store)
  ✅ PASS: GET /widget.js (legacy) HTTP Status Code (Value: 200)
  ✅ PASS: GET /widget.js (legacy) Short Cache-Control (Value: public, max-age=60)
  ✅ PASS: embed_snippet uses the versioned bundle URL (Value: <script src="http://localhost:3000/widget.v1.js?id=4" defer></script>)

======================================================================
 Test Execution Summary: 14 Passed, 0 Failed
======================================================================
```

---

## Stage 4: Public submission endpoint

**Command:** `bash test_stage_4.sh`
**Result:** all 7 checks passed. Tests 5, 6 and 7 prove that oversized bodies, malformed JSON and unknown routes get JSON error responses (an `application/json` content type) instead of Express's default HTML error page.

```
==================================================
RUNNING STAGE 4 VERIFICATION: Public Submission Endpoint
==================================================
[Test 1] Testing CORS OPTIONS Preflight... PASS (HTTP 204)
[Test 2] Submitting Valid Payload (Expect 201)... PASS (HTTP 201)
[Test 3] Rejecting Missing Required Fields (Expect 400)... PASS (HTTP 400)
[Test 4] Submitting to Non-Existent Widget (Expect 404)... PASS (HTTP 404)
[Test 5] Rejecting Oversized Payload > 100kb (Expect 413)... PASS (HTTP 413, application/json; charset=utf-8)
[Test 6] Rejecting Malformed JSON (Expect 400 JSON)... PASS (HTTP 400, JSON)
[Test 7] Unknown Route (Expect 404 JSON)... PASS (HTTP 404, JSON)
==================================================
STAGE 4 VERIFICATION COMPLETE: ALL CHECKS PASSED!
==================================================
```

### Stored submissions are linked to the right widget and tenant

**Command:** joins each stored submission to its widget to show which tenant owns it.

```
$ docker compose exec -T postgres psql -U postgres -d flyrank_db -c "SELECT s.id, s.widget_id, w.tenant_id FROM submissions s JOIN widgets w ON w.id = s.widget_id ORDER BY s.id DESC LIMIT 3;"
 id | widget_id | tenant_id 
----+-----------+-----------
  3 |         1 |         1
  2 |         1 |         1
  1 |         1 |         1
(3 rows)
```

Each valid submission that `test_stage_4.sh` sends to widget `1` (Test 2) adds one row, and the three most recent are shown. The `submissions` table stores `widget_id` only; the tenant is reached through the widget's `tenant_id`, which is why the query joins the two tables. Widget `1` belongs to tenant `1`.
