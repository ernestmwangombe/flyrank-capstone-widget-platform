# FlyRank Capstone - Evidence Log

Every proof below is raw terminal output from a real run: Git Bash on Windows with Docker Desktop, started with `docker compose up --build`, against the PostgreSQL 15 container. Nothing is edited except that the shell prompt lines and Docker's "`version` is obsolete" warning were removed, and the output of each script is shown under its own heading.

**Run date:** 2026-10-02 for the seed step and Stages 1 and 2. Stage 4 was re-run after the JSON error handler was added, and Stage 3 was re-run after the loader-safety test (Suite 6) was added.
Stage 5 was run afterwards on the same Docker stack.
**Stages covered:** 1 to 5

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
| Rate limiting per IP and/or per widget returns 429 under a burst, and the API keeps serving legitimate traffic | [Stage 5](#stage-5-protection-enrichment-and-safe-side-effects): Test Suites 4 and 5 |
| At least one spam-prevention technique demonstrably blocks a spam submission | [Stage 5](#stage-5-protection-enrichment-and-safe-side-effects): Test Suite 1 (honeypot) |
| IP-to-geo enrichment uses a provider fallback chain; all providers down still stores the submission without geo | [Stage 5](#stage-5-protection-enrichment-and-safe-side-effects): Test Suite 2 |
| A failing confirmation email does not prevent the submission from being stored | [Stage 5](#stage-5-protection-enrichment-and-safe-side-effects): Test Suite 3 |

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
**Result:** 16 passed, 0 failed. Suites 1 and 5 cover the versioned bundle, Suites 2 to 4 cover the config endpoint and its cache headers, and Suite 6 checks that the loader shows widget text as plain text (no `innerHTML`).

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
  ✅ PASS: embed_snippet uses the versioned bundle URL (Value: <script src="http://localhost:3000/widget.v1.js?id=8" defer></script>)

[Test Suite 6] Verifying the loader shows widget text safely...
  ✅ PASS: loader does not use innerHTML
  ✅ PASS: loader sets widget text with textContent

======================================================================
 Test Execution Summary: 16 Passed, 0 Failed
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

---

## Stage 5: Protection, enrichment and safe side effects

**Command:** `bash test_stage_5.sh`
**Result:** 34 passed, 0 failed.

| Suite | What it proves |
|---|---|
| 1 | A bot that fills the hidden `website` field gets a normal `201` but nothing is stored (row count unchanged); a normal visitor is stored |
| 2 | Provider A answers; with A down, provider B answers; with both down the submission is still stored and its `geo` column is empty |
| 3 | A working confirmation email is sent (log line); with the email forced to fail the submission still returns `201`, is stored, and a failure `ALERT` appears in the app log |
| 4 | A burst of 40 rapid requests from one visitor gets `429` with scope `ip`; right after it another visitor and `/health` are served, and the same visitor succeeds again after a 2 second pause |
| 5 | A flood of 60 requests from 60 different visitors to one widget gets `429` with scope `widget`, while another widget and `/health` are still served |

Notes on reading the output:
- The geo providers in this run are the built-in mock providers (`GEO_MODE=mock`), as the brief asks for a deterministic fallback proof. The real ip-api.com and ipapi.co services were not called in this run.
- The test pretends to be different visitors with the development-only `X-Test-Client-Ip` header, and forces failures with `X-Test-Geo-Down` and `X-Test-Notify-Fail` (enabled by `TEST_CONTROLS=true`).
- In the burst suites the split between accepted and `429` depends on how fast the machine sends requests, because tokens refill while the requests are being sent. Any split with at least one of each is a pass.
- The suite reads the database and the app log through `docker compose exec` and `docker compose logs`.

```
==========================================================
 Starting Stage 5: Protection, Enrichment & Safe Side Effects
 Target API Server: http://localhost:3000
==========================================================

[Setup] Checking database access and creating test widgets...
  database access OK
  widgets created: main=5 ip-burst=6 flood=7
  test controls active (TEST_CONTROLS=true, GEO_MODE=mock)

[Test Suite 1] Honeypot: a bot that fills the hidden 'website' field is dropped...
  ✅ PASS: honeypot submission gets the normal success status (Value: 201)
  ✅ PASS: honeypot reply has no submission_id (Value: none)
  ✅ PASS: honeypot spam was NOT stored (row count unchanged) (Value: 1)
  ✅ PASS: normal submission (empty honeypot) is accepted (Value: 201)
  ✅ PASS: normal submission is stored (has submission_id) (Value: true)
  ✅ PASS: normal submission added exactly one row (Value: 2)

[Test Suite 2] Geo fallback chain: A -> B -> store anyway...
  ✅ PASS: A up: submission accepted (Value: 201)
  ✅ PASS: A up: response names provider A (Value: mock-a)
  ✅ PASS: A up: geo stored in the database (Value: mock-a)
  ✅ PASS: A down: submission still accepted (Value: 201)
  ✅ PASS: A down: response names provider B (Value: mock-b)
  ✅ PASS: A down: enriched by provider B in the database (Value: mock-b)
  ✅ PASS: A and B down: submission still accepted (Value: 201)
  ✅ PASS: A and B down: enrichment reported unavailable (Value: unavailable)
  ✅ PASS: A and B down: submission was stored (Value: 1)
  ✅ PASS: A and B down: stored without geo data (geo IS NULL) (Value: t)

[Test Suite 3] Confirmation email: failure must not break the submission...
  ✅ PASS: email works: submission accepted (Value: 201)
  ✅ PASS: email works: confirmation was sent (log line found) (Value: 1)
  ✅ PASS: email fails: submission still accepted (Value: 201)
  ✅ PASS: email fails: submission was stored (Value: 1)
  ✅ PASS: email fails: failure alert raised in the log (Value: 1)

[Test Suite 4] Per-IP rate limit: 40 rapid requests from one visitor...
  results: accepted=19 rate_limited=21 server_errors=0
  ✅ PASS: burst: the first requests were accepted (19)
  ✅ PASS: burst: excess requests got 429 (21)
  ✅ PASS: burst: 429 body names scope 'ip' and is JSON
  ✅ PASS: burst: no 5xx errors (Value: 0)
  ✅ PASS: right after the burst a different visitor is still served (Value: 201)
  ✅ PASS: right after the burst /health still answers (Value: 200)
  ✅ PASS: after a 2 second pause the same visitor succeeds again (Value: 201)

[Test Suite 5] Per-widget rate limit: 60 requests from 60 different visitors to one widget...
  results: accepted=49 rate_limited=11 server_errors=0
  ✅ PASS: flood: the first requests were accepted (49)
  ✅ PASS: flood: excess requests got 429 (11)
  ✅ PASS: flood: 429 body names scope 'widget'
  ✅ PASS: flood: no 5xx errors (Value: 0)
  ✅ PASS: during the flood another widget is still served (Value: 201)
  ✅ PASS: after the flood /health still answers (Value: 200)

==========================================================
 Test Execution Summary: 34 Passed, 0 Failed
==========================================================
```

---

## Full regression run: Stages 1 to 5 together

After Stage 5 was added, the containers were recreated with `docker compose up` (the existing database volume was kept, so PostgreSQL reported "Skipping initialization") and all five stage scripts were run back to back:

```
bash test_stage_1.sh
bash test_stage_2.sh
bash test_stage_3.sh
bash test_stage_4.sh
bash test_stage_5.sh
```

**Result:** every script passed. These are the summary lines printed by the scripts (the full output of each stage is shown in its own section above):

| Script | Summary line printed |
|---|---|
| `test_stage_1.sh` | `ALL STAGE 1 TESTS PASSED SUCCESSFULLY!` |
| `test_stage_2.sh` | `STAGE 2 VERIFICATION COMPLETE: ALL CHECKS PASSED!` |
| `test_stage_3.sh` | `Test Execution Summary: 16 Passed, 0 Failed` |
| `test_stage_4.sh` | `STAGE 4 VERIFICATION COMPLETE: ALL CHECKS PASSED!` (7 checks) |
| `test_stage_5.sh` | `Test Execution Summary: 34 Passed, 0 Failed` |

### What the application log shows during the Stage 5 tests

This is an excerpt of the app container's log from the same run. Each line is a structured JSON event, and none of them contains a visitor IP address or a full email address. They show the server-side behaviour behind the Stage 5 checks:

```
flyrank_app  | {"event":"email_sent","to":"e***@example.com","subject":"We received your submission","submission_id":148}
flyrank_app  | {"event":"geo_provider_failed","provider":"mock-a","error":"mock provider a is switched down"}
flyrank_app  | {"event":"spam_blocked","reason":"honeypot","widget_id":11}
flyrank_app  | {"event":"geo_provider_failed","provider":"mock-a","error":"mock provider a is switched down"}
flyrank_app  | {"event":"geo_provider_failed","provider":"mock-a","error":"mock provider a is switched down"}
flyrank_app  | {"event":"geo_provider_failed","provider":"mock-b","error":"mock provider b is switched down"}
flyrank_app  | {"event":"email_sent","to":"v***@example.com","subject":"We received your submission","submission_id":154}
flyrank_app  | {"event":"notification_attempt_failed","submission_id":155,"attempt":1,"error":"Simulated email provider outage"}
flyrank_app  | {"event":"notification_attempt_failed","submission_id":155,"attempt":2,"error":"Simulated email provider outage"}
flyrank_app  | {"event":"notification_attempt_failed","submission_id":155,"attempt":3,"error":"Simulated email provider outage"}
flyrank_app  | {"event":"ALERT","message":"Confirmation notification permanently failed after retries","submission_id":155,"attempts":3}
flyrank_app  | {"event":"rate_limited","scope":"ip"}
flyrank_app  | {"event":"rate_limited","scope":"widget"}
```

How to read it:
- `spam_blocked` is the honeypot dropping a bot submission for widget 11.
- `geo_provider_failed` for `mock-a` alone is the "provider A down, provider B answers" case. A failure for `mock-a` followed by `mock-b` is the "both providers down" case.
- Submission 155 shows the confirmation email being retried three times and then raising the `ALERT`, while its `201` response and stored row are covered by Test Suite 3.
- The `rate_limited` lines appear once for every request that received a `429` (many identical lines were left out of this excerpt).

### A PostgreSQL error line that is expected

The PostgreSQL log in the same run contains this line:

```
flyrank_postgres  | ERROR:  duplicate key value violates unique constraint "tenants_email_key"
flyrank_postgres  | DETAIL:  Key (email)=(tenant_a_1791122610@example.com) already exists.
```

It comes from Stage 1's "Duplicate Registration Rejected" check, which registers the same email twice on purpose. The database refuses the second insert, and the API turns that into the `409` response the test expects.
