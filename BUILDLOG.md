# FlyRank Capstone - Build & AI Engineering Log

An honest record of where AI helped, where it was wrong, and what I changed. Entries for Stages 1 to 3 are kept as originally written, with corrections added where problems were found later.

**How to read this log.** "The AI" means the AI assistant I worked with (Claude, in chat sessions). "I" means me. For the fixes after Stage 3, Stage 4 and Stage 5, the pattern was the same: the AI diagnosed problems and wrote the code from the files, logs and screenshots I gave it, and tested it in its own environment, which has no Docker and no access to the real geo services. I decided what to work on next, applied the files to my project, ran every test script on my own machine (Git Bash on Windows with Docker Desktop), pasted the real output back, and made the commits. Checks the AI ran in its own environment are labelled as such and are not my test runs.

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

What was done about it, in the commit `fix(stage-1,3): restore JWT auth and full CRUD, add versioned widget bundle` (the AI wrote the code in a separate chat session from my project files; I applied it, ran the stage scripts on my machine and committed it):
- Restored register and login with bcrypt-hashed passwords (`bcryptjs`, because it needs no native build on the Alpine Docker image) and signed HS256 JWTs.
- Rebuilt `authenticateTenant` so only a valid, unexpired token is accepted; the server refuses to start without `JWT_SECRET`.
- Added the missing `PUT` and `DELETE` routes, with every query filtered by the `tenant_id` from the verified token.
- Extended `test_stage_1.sh` with attack cases: a made-up Bearer string, an `x-tenant-id` header and a tampered token must all return `401`, and tenant B must get `404` when reading, updating or deleting tenant A's widget.
- The old `EVIDENCE.md` was replaced because it showed the mock token.

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
The first version served `/widget.js` as `immutable` for a year at one fixed URL. After any code change, browsers that had cached it would never fetch the new script, which is the stale-code problem the brief warns about. The line in the old log about updating `setup_db.js` for seeding is also out of date: seeding now happens through `schema.sql`, and `setup_db.js` has since been deleted.

What changed (written by the AI, applied and tested by me):
- The bundle is now served at `/widget.v1.js`. The version comes from `WIDGET_VERSION` (default `1`), so a new release gets a new URL and can be cached for a year safely.
- A request for any other version, such as `/widget.v999.js`, returns `404` with `no-store`.
- The embed snippet now points at the versioned URL.
- The old `/widget.js` URL still works so existing embeds do not break, but it is cached for only 60 seconds and is no longer `immutable`.
- Added Test Suite 5 to `test_stage_3.sh` for these cases.

---

## Stage 4: Public Submission Endpoint
**Focus:** Cross-origin form submissions, input validation at the boundary, and safe storage.

### What the AI did
- Drafted `POST /api/embed/submit` (`src/routes/submission.js`) with Zod validation in `src/middleware/validateSubmission.js`, and drafted `test_stage_4.sh`.
- Diagnosed each failure below from the Docker and PostgreSQL logs, the code and the test output that I pasted into the chat, and wrote the fixes.

### What I did
- Ran the stack and the test script on my machine, pasted the failing output and logs, applied each fix to my project, and re-ran the tests until they passed.

### Where it went wrong
1. **Every submission returned 500: `relation "widgets" does not exist`.** The database container started empty. The Postgres log said it was ignoring `/docker-entrypoint-initdb.d/*`, and `docker-compose.yml` never mounted `schema.sql` there. Fix: mount `./schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro`. This only runs on a brand-new volume, so `docker compose down -v` is needed to re-seed.
2. **`ReferenceError: submissionContent is not defined`** in `submission.js`. The AI-drafted route used a variable it never created. It was hidden behind problem 1 and only appeared in the app log once the tables existed. Fix: define it from `payload` or `data`.
3. **I tested stale files.** After the fixes were written, the 500 kept coming back because I had not copied the corrected `submission.js` and `validateSubmission.js` into `src/`. The server log showed the same error at the same line. Lesson: confirm the file actually changed (`grep`, `diff`) before concluding a fix failed.
4. **Wrong entry point in Docker.** The compose command ran `src/index.js`, which does not exist. Fix: `npx nodemon server.js`.
5. **ID type mismatch.** The validator accepted UUIDs for `widget_id`, but `widgets.id` is an integer, and `parseInt` turned a UUID into the wrong number. Fix: accept positive integers only.
6. **Seed rows broke auto-increment.** The seed inserted explicit id `1` without advancing the serial counters, so the next normal insert would collide. Fix: `setval(...)` lines in `schema.sql`.
7. **Raw database errors leaked to callers** in the 500 body. Fix: generic message, details logged server-side only.
8. **`test_stage_4.sh` Test 5 died silently**, then failed on my machine with `Argument list too long` in Git Bash. First cause: a pipeline ending in `head` combined with `set -o pipefail` (SIGPIPE, exit 141). Second cause: a 105 KB value cannot be passed as a `curl` argument on Git Bash. Fix: write the body to a temporary file and send it with `--data-binary @file`.
9. **AI miscount.** An AI summary said Stage 3 would show 15 passes; my real run showed 14. I trust the run output, not the prediction.

### Hardening: JSON errors everywhere
Malformed or oversized bodies returned Express's default HTML error page (correct status, wrong format), and unknown routes returned HTML 404s. The AI wrote a catch-all 404 and a global error handler for `server.js`, below all routes, and I applied it:
- Malformed JSON returns `400`, oversized bodies return `413`, unsupported encodings return `415`, any other client error keeps its 4xx status, and anything unexpected returns a generic `500`.
- The parser's own error message is deliberately not sent back, because it can reveal internals.
- CORS headers still appear on these error responses, so browsers on other origins can read them.
- `test_stage_4.sh` now also checks that the oversized response is JSON, that malformed JSON gives a JSON `400`, and that an unknown route gives a JSON `404`. I ran it on my machine and all 7 checks passed.
- The AI also tried about a dozen malformed, oversized and unknown-route cases in its own environment before handing the code over; those runs are not in my evidence file.

---

## Configuration and housekeeping fixes
The AI found these by reading my repository against the brief; I applied them.
- `.env.example` set `DATABASE_URL` to a `lead_capture` database. `db.js` prefers `DATABASE_URL` over the `DB_*` variables, so copying that file would have pointed a clean Docker run at the wrong database. It now uses `flyrank_db` with `DATABASE_URL` commented out.
- `docker-compose.yml` hard-coded `JWT_SECRET`, so the value in `.env` was ignored. It now reads `${JWT_SECRET:-dev_only_change_me}`.
- `capstone.yaml` had lost its line breaks and listed the wrong database and endpoints. The AI rewrote it and, in its own environment, ran a script that calls every endpoint it lists. On my machine I ran the new `seed:` command and the test scripts successfully.

---

## Cleanup and security fixes (found while reviewing the project)
An earlier version of this log listed three problems; all three are now fixed. The AI wrote the changes; I applied them, ran `test_stage_3.sh` on my machine (16 passed) and made the commits.
- **Database error text leaked from the public config endpoint.** On a database failure it returned `err.message` in a `details` field. It now returns only `{ "error": "Database query failed" }`; the full error is still logged on the server. The AI confirmed this in its own environment by stopping the database and calling the endpoint; I did not repeat that check.
- **The widget loader built its card with `innerHTML`.** A widget title such as `<img src=x onerror=...>` would have run as markup on the customer's website. The loader now creates the elements with DOM methods and sets the title and button label with `textContent`. The AI verified this in its own environment by running the served script in a simulated browser (jsdom) with a hostile title: the text was shown literally, no `<img>` or `<script>` element was created, and nothing executed. On my machine, the new Test Suite 6 in `test_stage_3.sh` checks that the served script does not use `innerHTML` and does use `textContent`.
- **Unused files removed.** I deleted `fix_db.js`, `setup_db.js`, `src/app.js`, `src/middleware/rateLimiter.js` and a duplicate root `submission.js` with `git rm`. The AI had checked that nothing imported or referenced them, and that `rateLimiter.js` depended on a package that is not installed. (A new, different `src/middleware/rateLimiter.js` was added in Stage 5.)

I also did a "stranger test": cloned the repository into a new folder, copied `.env.example` to `.env`, ran `docker compose up --build`, and ran the four stage scripts. All passed.

Remaining limitations are listed in the README.

---

## Repository history note
The Stage 3 commit was first pushed as `implement Fast, cached widget delivery`, without the `feat(stage-3):` prefix the other commits use. To make the history uniform I ran `git rebase -i 9573585`, changed that commit from `pick` to `reword`, edited the message, and pushed with `git push --force-with-lease`.

Rebasing replays the commits after the edited one, so the Stage 3, Stage 4 and "restore JWT auth" commits received new hashes (`f6db705`, `4579e78`, `711cf03`). I changed only a commit message; I did not edit files or reorder commits, and the Stage 3 commit kept its original date.

The brief asks not to rewrite history before submission because the journey is evidence, so I am recording it here. `--force-with-lease` is safer than a plain force push, but it is still a history rewrite. From now on I fix mistakes with a new commit and do not rewrite pushed history.

---

## Stage 5: Protection, Enrichment & Safe Side Effects
**Focus:** Abuse resistance (rate limiting, spam control), graceful degradation (geo fallback chain), and side effects that must never break the main path.

### What the AI did
- Proposed the design, then wrote all of the Stage 5 code with a comment on every line: `src/middleware/rateLimiter.js`, `src/middleware/honeypot.js`, `src/services/geoService.js`, `src/services/notifier.js`, `src/services/submissionService.js`, `src/repositories/submissionRepository.js`, `src/utils/clientIp.js`, `src/utils/testControls.js`, the rewritten `src/routes/submission.js`, and the changes to `server.js`, `schema.sql`, `docker-compose.yml`, `.env.example` and `capstone.yaml`.
- Split the submission path into layers: the route handles HTTP, `submissionService.js` holds the logic, `submissionRepository.js` runs the SQL, and `geoService.js` and `notifier.js` handle the optional extras.
- Wrote `test_stage_5.sh`, and updated the README.

### What I did
- Gave the AI the Stage 5 section of the brief and my project files, and asked it to continue.
- Was shown the main design choices below before any code was written, and told the AI to carry on with them.
- Applied the Stage 5 files to my project, rebuilt the Docker stack, and ran `test_stage_5.sh` on my machine: 34 passed, 0 failed.
- Ran all five stage scripts together on my machine: every script passed, and my app log showed the retries, the `ALERT`, the honeypot drop, the geo failures and the `429` events. The output is in `EVIDENCE.md`.

### Design decisions (proposed by the AI, approved by me)
- **Rate limiting is a small token-bucket limiter the AI wrote, not the `express-rate-limit` package.** Each IP (and each widget) has a bucket of tokens; a request spends one and tokens drip back in. That gives the behaviour the brief asks for: a burst gets `429`, yet a normal request a moment later succeeds, and other visitors are never affected. The cost is more code to maintain, and the buckets live in server memory (they reset on restart and are not shared between instances). The per-IP limiter runs before the JSON body parser so floods of malformed or oversized bodies are turned away before they are parsed. CORS preflight requests are not counted.
- **Honeypot spam control.** A filled hidden `website` field is dropped silently: the bot gets a normal `201` without a `submission_id` and nothing is stored, so it learns nothing.
- **Geo fallback chain.** Provider A (ip-api.com), then provider B (ipapi.co), each with a timeout; if both fail the submission is stored with `geo` empty. Enrichment uses the IP address the server observed, never the client-claimed `metadata.ip_address`. Private and local addresses are skipped in real mode.
- **Safe side effect.** The confirmation email is a background job with up to three attempts and growing delays, and an `ALERT` log line if every attempt fails. It is simulated (a log line with the address masked). Jobs live in memory and are lost on restart.
- **Development-only test controls (`TEST_CONTROLS=true`).** Headers such as `X-Test-Geo-Down` and `X-Test-Notify-Fail` let the tests force the failure cases, as the brief's probes need, and `X-Test-Client-Ip` lets one machine act as many visitors. They are on by default in `docker-compose.yml` for development and must be off in production. `GEO_MODE=mock` is the default so the fallback proof is repeatable and works offline.

### Checks the AI ran in its own environment (not my test runs)
The AI's environment has no Docker and no internet access to the geo services, so it used a local PostgreSQL, a stand-in for the `docker` command, and fake local servers. These runs are not in `EVIDENCE.md`:
- It broke each feature on purpose (rate limits effectively off, test controls off) and confirmed `test_stage_5.sh` fails for the right reason. That also showed the script gave confusing failures when `TEST_CONTROLS` or `GEO_MODE` was wrong, so it added a pre-flight check that stops with a plain explanation.
- With `TEST_CONTROLS=false` (the production setting) the limiter still works, and a spoofed `X-Test-Client-Ip` header is ignored.
- It exercised the real geo provider code against two fake local servers that imitate the response formats of ip-api.com and ipapi.co (success, HTTP 500, a hang that hits the timeout, failure bodies, garbage, a missing country). **The real live services have not been called by any test, mine or the AI's.** The free ip-api.com tier is plain HTTP only.
- In one of its runs a variant seemed to show the limiter not working; the cause was the previous test server still holding the port, not the code. A re-run on a clean port showed the limiter working.

### Numbers on my machine
In the burst suites the split between accepted and `429` depends on machine speed, because tokens refill while the requests are sent. My two runs accepted 19 and 15 of 40 from one visitor, and 49 and 46 of 60 on one widget; every run gave at least one `429` and no server errors.

### Known limitations
- Rate limit buckets and queued confirmation emails are in memory only.
- Only the submission path is split into logic and data layers; the auth and widget CRUD routes are still written inside `server.js`.
- Schema changes are made by editing `schema.sql` and resetting the database volume, not through migrations.
