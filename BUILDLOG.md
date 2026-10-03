# FlyRank Capstone - Build & AI Engineering Log

An honest record of where AI helped, where it was wrong, and what I changed. Entries for Stages 1 to 3 are kept as originally written, with corrections added where I later found them to be wrong.

---

## Stage 1: Widget Management API
**Focus:** Multi-tenant database schema, authenticated RESTful CRUD operations, and data persistence.

### What AI Helped With
- Generated initial Express middleware structure for JWT verification (`authenticateTenant`).
- Structured multi-tenant PostgreSQL query templates using parameterized inputs (`WHERE id = $1 AND tenant_id = $2`) to prevent SQL injection.
- Drafted the initial automated Bash verification script (`test_stage_1.sh`).

### Adjustments & Fixes Made
- Enforced strict cascade deletion on foreign key constraints (`ON DELETE CASCADE`) to clean up child fields when widgets are dropped.
- Standardized error response structures across all API routes to consistently return JSON payloads formatted as `{ "error": "message" }`.
- Verified password hashing using `bcryptjs` for all registered tenant accounts during setup and authentication.

### Correction added 2026-10-02: Stage 1 had silently regressed
The Stage 2 commit rewrote `server.js` and replaced the real JWT authentication with a mock: any `x-tenant-id` header or any `Bearer` string was accepted as the tenant id. My README and this log still claimed JWT and bcrypt, and `package.json` no longer listed them, so the documentation was wrong and tenant isolation was not real. This came to light when the code was reviewed against the brief's requirements (with AI assistance), not from a failing test, because the old `test_stage_1.sh` and the old evidence still ran against the mock.

What I did about it (commit `fix(stage-1,3): restore JWT auth and full CRUD, add versioned widget bundle`):
- Restored register and login with bcrypt-hashed passwords (`bcryptjs`, because it needs no native build on the Alpine Docker image) and signed HS256 JWTs.
- Rebuilt `authenticateTenant` so only a valid, unexpired token is accepted; the server refuses to start without `JWT_SECRET`.
- Added the missing `PUT` and `DELETE` routes, with every query filtered by the `tenant_id` from the verified token.
- Extended `test_stage_1.sh` with attack cases: a made-up Bearer string, an `x-tenant-id` header and a tampered token must all return `401`, and tenant B must get `404` when reading, updating or deleting tenant A's widget.
- Replaced the old `EVIDENCE.md` because it showed the mock token.

---

## Stage 2: Dynamic Embed Snippet Generation
**Focus:** Cross-origin script delivery, dynamic snippet construction, and DB read consistency.

### What AI Helped With
- Drafted helper utilities to build dynamic HTML script tags based on active server host configuration (`BASE_URL`).
- Structured `test_stage_2.sh` to extract JSON properties from `curl` responses and validate snippet string formatting automatically.

### Adjustments & Fixes Made
- Updated `POST /api/widgets` and `GET /api/widgets/:id` handlers to automatically inject the computed `embed_snippet` attribute into outgoing JSON responses.
- Enforced `defer` script attributes on generated script tags (`<script src="..." defer></script>`) to prevent blocking DOM parsing on host pages.
- Standardized port binding configurations in `server.js` using environment variables (`PORT=3000`) with safe fallbacks.
- `test_stage_2.sh` originally used the fake token `tenant_alpha_token_123`; once real authentication was restored it registers a tenant and logs in first.

---

## Stage 3: Fast, Cached Widget Delivery
**Focus:** Public CDN-style asset distribution, HTTP Cache-Control header strategies, and defensive parameter validation.

### What AI Helped With
- Generated initial Express route definitions for serving static JavaScript bundles (`GET /widget.js`) and public JSON configurations (`GET /api/widgets/:id/config`).
- Drafted assertion tests for `test_stage_3.sh` using `curl -I` status code and header inspection flags.

### Adjustments & Fixes Made
- **Header Hardening:** Configured long-term immutable caching (`Cache-Control: public, max-age=31536000, immutable`) for the widget bundle to simulate CDN edge delivery.
- **Dynamic Config Caching:** Implemented short-term caching (`Cache-Control: public, max-age=60`) and global CORS headers (`Access-Control-Allow-Origin: *`) on public widget config endpoints.
- **Defensive Error Handling:** Added parameter parsing (`parseInt`) on `GET /api/widgets/:id/config`. Non-numeric parameters return `400 Bad Request`, and missing records return `404 Not Found` paired with `Cache-Control: no-store` to prevent caching error states on downstream proxy caches.

### Correction added 2026-10-02: the bundle was not really versioned
The first version served `/widget.js` as `immutable` for a year at one fixed URL. After any code change, browsers that had cached it would never fetch the new script, which is the stale-code problem the brief warns about. The line in the old log about updating `setup_db.js` for seeding is also out of date: seeding now happens through `schema.sql`, and `setup_db.js` is no longer used.

What I changed:
- The bundle is now served at `/widget.v1.js`. The version comes from `WIDGET_VERSION` (default `1`), so a new release gets a new URL and can be cached for a year safely.
- A request for any other version, such as `/widget.v999.js`, returns `404` with `no-store`.
- The embed snippet now points at the versioned URL.
- The old `/widget.js` URL still works so existing embeds do not break, but it is cached for only 60 seconds and is no longer `immutable`.
- Added Test Suite 5 to `test_stage_3.sh` for these cases.

---

## Stage 4: Public Submission Endpoint
**Focus:** Cross-origin form submissions, input validation at the boundary, and safe storage.

### What AI Helped With
- Drafted `POST /api/embed/submit` (`src/routes/submission.js`) with Zod validation in `src/middleware/validateSubmission.js`.
- Drafted `test_stage_4.sh` (preflight, valid submission, missing fields, unknown widget, oversized body).
- Helped me trace the failures below from the Docker and PostgreSQL logs.

### Where it went wrong, and what I did
1. **Every submission returned 500: `relation "widgets" does not exist`.** The database container started empty. The Postgres log said it was ignoring `/docker-entrypoint-initdb.d/*`, and `docker-compose.yml` never mounted `schema.sql` there. Fix: mount `./schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro`. This only runs on a brand-new volume, so `docker compose down -v` is needed to re-seed.
2. **`ReferenceError: submissionContent is not defined`** in `submission.js`. The AI-drafted route used a variable it never created. I only found it because it was hidden behind problem 1. Fix: define it from `payload` or `data`.
3. **I tested stale files.** After the fixes were written, the 500 kept coming back because I had not copied the corrected `submission.js` and `validateSubmission.js` into `src/`. The server log showed the same error at the same line. Lesson: confirm the file actually changed (`grep`, `diff`) before concluding a fix failed.
4. **Wrong entry point in Docker.** The compose command ran `src/index.js`, which does not exist. Fix: `npx nodemon server.js`.
5. **ID type mismatch.** The validator accepted UUIDs for `widget_id`, but `widgets.id` is an integer, and `parseInt` turned a UUID into the wrong number. Fix: accept positive integers only.
6. **Seed rows broke auto-increment.** The seed inserted explicit id `1` without advancing the serial counters, so the next normal insert would collide. Fix: `setval(...)` lines in `schema.sql`.
7. **Raw database errors leaked to callers** in the 500 body. Fix: generic message, details logged server-side only.
8. **`test_stage_4.sh` Test 5 died silently**, then failed with `Argument list too long` on Windows Git Bash. First cause: a pipeline ending in `head` combined with `set -o pipefail` (SIGPIPE, exit 141). Second cause: a 105 KB value cannot be passed as a `curl` argument on Git Bash. Fix: write the body to a temporary file and send it with `--data-binary @file`.
9. **AI miscount.** An AI summary said Stage 3 would show 15 passes; the real run showed 14. I trust the run output, not the prediction.

### Hardening: JSON errors everywhere
Malformed or oversized bodies returned Express's default HTML error page (correct status, wrong format), and unknown routes returned HTML 404s. I added a catch-all 404 and a global error handler to `server.js`, below all routes:
- Malformed JSON returns `400`, oversized bodies return `413`, unsupported encodings return `415`, any other client error keeps its 4xx status, and anything unexpected returns a generic `500`.
- The parser's own error message is deliberately not sent back, because it can reveal internals.
- CORS headers still appear on these error responses, so browsers on other origins can read them.
- `test_stage_4.sh` now also checks that the oversized response is JSON, that malformed JSON gives a JSON `400`, and that an unknown route gives a JSON `404`.

---

## Configuration and housekeeping fixes
- `.env.example` set `DATABASE_URL` to a `lead_capture` database. `db.js` prefers `DATABASE_URL` over the `DB_*` variables, so copying that file would have pointed a clean Docker run at the wrong database. It now uses `flyrank_db` with `DATABASE_URL` commented out.
- `docker-compose.yml` hard-coded `JWT_SECRET`, so the value in `.env` was ignored. It now reads `${JWT_SECRET:-dev_only_change_me}`.
- `capstone.yaml` had lost its line breaks and listed the wrong database and endpoints. Rewritten; I checked that every endpoint it lists returns its expected status.

---

## Known issues I have noticed and not fixed
- The public config endpoint returns `err.message` in a `details` field when the database query fails, which can leak internal error text. The widget management routes already return a generic message.
- The widget loader builds its card with `innerHTML` using the widget's `title` and `buttonText`, so a tenant could inject markup into their own widget. These values should be set with `textContent`.
- `fix_db.js`, `setup_db.js`, `src/app.js`, `src/middleware/rateLimiter.js` and a duplicate root `submission.js` are unused and still tracked.
