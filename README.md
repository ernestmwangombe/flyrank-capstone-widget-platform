# FlyRank Capstone - Embeddable Widget & Lead-Capture Platform

A multi-tenant backend that lets a customer create an embeddable widget, hands them a one-line `<script>` snippet, and safely accepts the form submissions that come back from any website on the public internet.

Built for the FlyRank Internship Backend Track capstone with **Node.js, Express and PostgreSQL**, run with **Docker**. Everything uses free tools and needs no credit card.

> **Project status: Stages 1-7 complete.**
> Authentication, widget management, embed snippets, versioned and cached widget delivery, the public submission endpoint, its protection layers (rate limiting, spam control, geo enrichment with a fallback chain, and a safe confirmation side effect), the owner dashboard API (submissions list and analytics), and a customer test site on a second origin where the widget renders as a form and submits across origins are built and tested. This README describes the project as it stands after Stage 7 and is extended as each new stage is completed.

---

## What the system does

There are three kinds of people ("actors") and each has its own request path:

| Actor | What they do | Path |
|-------|--------------|------|
| **Widget owner** (tenant) | Registers, logs in, creates and manages widgets, copies the embed snippet, reads their submissions and statistics | Authenticated API (`/api/auth/*`, `/api/widgets/*`, `/api/dashboard/*`) |
| **Customer website** | Pastes the snippet; the browser loads the script, draws the form from the widget's config and submits it across origins | Public, cached, CORS-enabled (`/widget.v2.js`, `/api/widgets/:id/config`) |
| **Website visitor** | Submits the form | Public, CORS-enabled, validated, rate-limited and spam-filtered (`POST /api/embed/submit`) |

Because the public endpoints receive requests straight from browsers the server does not control, input is never trusted: every field is validated before it reaches the database, floods and bots are turned away before they cost anything, optional extras (location lookup, confirmation email) can fail without breaking a submission, and every tenant query is filtered by the tenant id taken from a signed token.

---

## Architecture

```mermaid
flowchart TD
    Owner["Widget Owner<br/>(authenticated)"]
    Site["Customer Website<br/>(any origin)"]
    Visitor["Website Visitor<br/>(any origin)"]
    API["Express API Server<br/>(Node.js)"]
    DB[("PostgreSQL<br/>tenants / widgets / submissions")]
    Geo["Geo providers<br/>A then B"]
    Mail["Confirmation email<br/>(background job)"]

    Owner -- "POST /api/auth/register, /login<br/>JWT Bearer token" --> API
    Owner -- "CRUD /api/widgets<br/>(tenant-isolated)" --> API
    Owner -- "GET /api/dashboard/*<br/>submissions + stats (tenant-isolated)" --> API
    Site -- "GET /widget.v2.js<br/>Cache: 1 year, immutable" --> API
    Site -- "GET /api/widgets/:id/config<br/>CORS *, Cache: 60 s" --> API
    Visitor -- "POST /api/embed/submit<br/>CORS + preflight, rate limited" --> API
    API -- "SQL (parameterised)" --> DB
    API -- "IP lookup: A, then B<br/>if both fail: store anyway" --> Geo
    API -- "queued after storing<br/>retried, never blocks the reply" --> Mail
```

The same request paths as a plain-text sketch:

```
Widget Owner --(JWT)--> Widget Management API --> widgets table (tenant_id filter) --> embed snippet

Widget Owner --(JWT)--> Dashboard API --> submissions JOIN widgets (tenant_id filter) --> list, per-widget stats, counts over time, geo breakdown

Customer Site: <script src=".../widget.v2.js?id=1">
   --> GET /widget.v2.js            (public, cached 1 year, versioned URL)
   --> GET /api/widgets/:id/config  (public, cached 60 s, CORS *)
   --> render the form, then on submit: OPTIONS preflight + POST /api/embed/submit (see Visitor path)

Visitor --> POST /api/embed/submit  (public, CORS)
   | rate limit per IP            -> flood? 429 (before the body is even parsed)
   | validation                  -> bad payload? 4xx JSON
   | honeypot filled?            -> silently dropped, nothing stored
   | rate limit per widget       -> flood? 429
   | widget exists?              -> no? 404
   | geo enrichment              -> provider A, then provider B, then store without geo
   | store submission            -> 201
   | confirmation email          -> queued in the background; failure never changes the 201
```

**Code layout**

```
server.js                              App setup, auth routes, widget CRUD, widget delivery routes, error handlers
db.js                                  PostgreSQL connection pool
src/routes/submission.js               HTTP layer: POST /api/embed/submit
src/middleware/validateSubmission.js   Zod validation for submissions
src/middleware/authenticateTenant.js   JWT login check shared by the widget and dashboard routes
src/middleware/validateDashboard.js    Zod validation for the dashboard query strings and ids
src/routes/dashboard.js                HTTP layer: /api/dashboard/*
src/services/dashboardService.js       Logic layer: widget ownership checks and response shaping
src/repositories/dashboardRepository.js  Data layer: the tenant-isolated dashboard SQL
src/middleware/honeypot.js             Spam control: hidden "website" field
src/middleware/rateLimiter.js          Token-bucket rate limits per IP and per widget
src/services/submissionService.js      Logic layer: check widget, enrich, store, queue the confirmation
src/services/geoService.js             IP -> location, provider A then provider B (real or mock)
src/services/notifier.js               Background confirmation email with retries and a failure alert
src/repositories/submissionRepository.js   Data layer: the submission SQL
src/utils/                             Client IP detection and the development-only test switches
schema.sql                             Tables, indexes and seed rows (run automatically on first boot)
docker-compose.yml                     App + PostgreSQL services
Dockerfile                             Node 20 Alpine image for the app
capstone.yaml                          Manifest: run, seed, test commands and endpoints
src/widget/widget.v2.js                The widget loader (version 2) that runs on customer sites
src/widget/bundleLoader.js             Reads a loader file and strips its comments before it is served
customer-site/index.html               Plain HTML test page for the second origin (served by nginx on port 5500)
docs/DESIGN.md                         One-page design: problem, data model, API surface, layers, pipeline, one explicit non-goal
docs/evidence/                         Browser screenshots referenced from EVIDENCE.md
test_stage_1.sh ... test_stage_7.sh    Integration test scripts, one per stage
```

---

## Quick start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose)
- [Git](https://git-scm.com/) and a Bash shell (Git Bash on Windows is fine)
- [`jq`](https://jqlang.github.io/jq/) and `curl` (the test scripts use them)
- The `docker compose` command on your PATH (`test_stage_5.sh` reads the database and the app log through it)

### 1. Get the code and create your environment file

```bash
git clone https://github.com/ernestmwangombe/flyrank-capstone-widget-platform.git
cd flyrank-capstone-widget-platform
cp .env.example .env
```

Open `.env` and set `JWT_SECRET` to any long random string. Docker Compose passes it to the app, and the server refuses to start without one. `.env` is git-ignored and must never be committed.

### 2. Run (one command)

```bash
docker compose up --build
```

Wait for this line in the output:

```
Server running successfully on port 3000
```

The API is now at `http://localhost:3000`. Check it with `curl http://localhost:3000/health`.

### 3. Seed

Seeding is built into the first start. On a brand-new database volume PostgreSQL runs `schema.sql` automatically, which:

- creates the `tenants`, `widgets` and `submissions` tables and their indexes, and
- inserts demo rows: a demo owner, tenant `1` (`dev@flyrank.ai`, password `DemoPass123!`, **for local development only**), and widget `1` ("Stage 4 Public Form Widget", configured with a name, an email and a message field). The public config and submission tests and the customer test site use widget `1`.

If you update an existing checkout, run the re-seed below once: Stage 5 added a `geo` column to `submissions` and Stage 6 replaced an index, and the database only reads `schema.sql` automatically when its volume is new. Either `docker compose down -v` then `docker compose up --build`, or just re-run the seed command from `capstone.yaml` against the running stack (it drops and recreates the tables and demo rows).

To **re-seed from scratch** (this deletes all data in the database volume):

```bash
docker compose down -v
docker compose up --build -V
```

You can log in as the demo owner (`dev@flyrank.ai` / `DemoPass123!`) to see the submissions that arrive on widget `1` in the dashboard API. To get your own data, register a tenant and create a widget through the API (see the examples below).

### 4. Try it

```bash
# Register a tenant
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"password123","company_name":"Demo Corp"}'

# Log in and keep the token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"password123"}' | jq -r '.token')

# Create a widget; the response includes the embed_snippet
curl -X POST http://localhost:3000/api/widgets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Newsletter","type":"signup_form","config":{"title":"Subscribe","buttonText":"Join"}}'

# Submit as a visitor (no token needed)
curl -X POST http://localhost:3000/api/embed/submit \
  -H "Content-Type: application/json" \
  -d '{"widget_id":1,"data":{"email":"visitor@example.com"}}'
```

### Environment variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `PORT` | HTTP port the API listens on | `3000` |
| `JWT_SECRET` | Secret used to sign login tokens (**required**) | a long random string |
| `JWT_EXPIRES_IN` | How long a login token stays valid (optional) | `1h` |
| `WIDGET_VERSION` | Bundle version used in new embed snippets (optional, default `2`; versions `1` and `2` exist). If your `.env` still says `1` from an earlier checkout, change it to `2`. | `2` |
| `BASE_URL` | Public base URL used in embed snippets (optional, defaults to the request host) | `http://localhost:3000` |
| `TEST_CONTROLS` | Development-only test switches (see [Test controls](#test-controls-development-only)). **Must be `false` in production.** | `true` |
| `GEO_MODE` | `mock` = built-in fake geo providers (repeatable), `real` = ip-api.com then ipapi.co | `mock` |
| `GEO_TIMEOUT_MS` | Milliseconds to wait for each geo provider | `1500` |
| `RATE_LIMIT_IP_BURST`, `RATE_LIMIT_IP_REFILL_PER_SEC` | Per-IP limit: burst size and tokens refilled per second | `10`, `2` |
| `RATE_LIMIT_WIDGET_BURST`, `RATE_LIMIT_WIDGET_REFILL_PER_SEC` | Per-widget limit shared by all visitors | `30`, `5` |
| `NOTIFY_MAX_ATTEMPTS`, `NOTIFY_RETRY_DELAY_MS` | Confirmation email attempts, and the first retry delay (doubles each time) | `3`, `300` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | PostgreSQL connection. `docker-compose.yml` sets these for the containers; the database is `flyrank_db`. | `postgres`, `5432`, `postgres`, `postgres`, `flyrank_db` |

---

## API reference

All errors are JSON in the form `{ "error": "message" }`. Submission validation errors add a `details` list. Unknown routes return `404`, malformed JSON bodies return `400` and oversized bodies return `413`, all as JSON rather than an HTML page.

### Authentication

Both route prefixes below work and behave identically: `/api/auth/*` and `/api/v1/admin/*`.

| Method | Endpoint | Auth | Success | Errors |
|--------|----------|------|---------|--------|
| `POST` | `/api/auth/register` | none | `201` tenant `{ id, email, company_name, created_at }` | `400` invalid or missing fields, `409` email already registered |
| `POST` | `/api/auth/login` | none | `200` `{ token, tenant }` | `400` missing fields, `401` wrong email or password |

Register rules: valid email, `company_name` 1-255 characters, password 8-72 characters. Passwords are stored as bcrypt hashes. Login returns a signed JWT (HS256) that carries only the tenant id.

### Widget management (authenticated)

Send the header `Authorization: Bearer <token>`. The tenant is always taken from the verified token, never from the request body or other headers. Each of these is also available under `/api/v1/admin/widgets`.

| Method | Endpoint | Success | Notes |
|--------|----------|---------|-------|
| `POST` | `/api/widgets` | `201` widget + `embed_snippet` | `name` required; `type` defaults to `lead_capture`; `config` must be a JSON object |
| `GET` | `/api/widgets` | `200` array of the tenant's widgets | Only the caller's widgets |
| `GET` | `/api/widgets/:id` | `200` widget + `embed_snippet` | Another tenant's widget returns `404` |
| `PUT` | `/api/widgets/:id` | `200` updated widget | Provide at least one of `name`, `type`, `config` |
| `DELETE` | `/api/widgets/:id` | `200` `{ message, id }` | Also deletes the widget's submissions (cascade) |

Common errors: `401` missing, invalid, tampered or expired token; `400` invalid id or body; `404` widget not found or belongs to another tenant.

### Public widget delivery (no auth, CORS `*`)

| Method | Endpoint | Cache-Control | Description |
|--------|----------|---------------|-------------|
| `GET` | `/widget.v2.js?id=<widget id>` | `public, max-age=31536000, immutable` | Current versioned loader script (version 2: draws the form and submits it). The version in the URL is the release; a new release gets a new URL, so browsers can cache forever without serving stale code. Published versions never change and stay available: `/widget.v1.js` (the original display-only card) is still served for old embeds. An unknown version returns `404` with `no-store`. |
| `GET` | `/widget.js?id=<widget id>` | `public, max-age=60` | Legacy unversioned URL kept so older snippets keep working; cached only briefly. |
| `GET` | `/api/widgets/:id/config` | `public, max-age=60` | Widget configuration JSON. `400` for a non-numeric id and `404` for an unknown widget, both with `no-store`. |

The embed snippet returned by the management API looks like:

```html
<script src="http://localhost:3000/widget.v2.js?id=1" defer></script>
```

### Public submission (no auth, CORS enabled)

`POST /api/embed/submit`

```json
{
  "widget_id": 1,
  "data": { "email": "visitor@example.com", "feedback": "Great platform!" },
  "metadata": { "page_url": "https://client-website.com/contact" }
}
```

- `widget_id`: positive integer (numeric strings such as `"1"` are accepted).
- `data` **or** `payload`: a non-empty JSON object holding the form fields. Include a hidden input named `website` in the form as the [honeypot](#protection-enrichment-and-safe-side-effects); real visitors leave it empty.
- `metadata` (optional): `source_url`, `page_url` (valid URLs), `referrer`, `ip_address` (valid IPv4/IPv6).
- `OPTIONS /api/embed/submit` answers the CORS preflight with `204`.

| Status | Meaning |
|--------|---------|
| `201` | Stored. Body: `{ message, submission_id, widget_id, created_at, enrichment: { status, provider } }`. A honeypot hit also returns `201` with only `{ message }` and stores nothing. |
| `400` | Validation failed (body: `{ error: "Validation Failed", details: [{ field, message }] }`) or malformed JSON (body: `{ error: "..." }`) |
| `404` | The widget does not exist |
| `413` | Body larger than the 10 KB limit (JSON error) |
| `429` | Too many requests. Body: `{ error, scope: "ip" or "widget", retry_after_seconds }`, plus a `Retry-After` header |
| `500` | Unexpected server error (generic message; details are logged server-side only) |

## Customer test site (second origin)

`docker compose up --build` also starts a tiny nginx container that serves `customer-site/index.html` on **http://localhost:5500**. It plays the part of a customer's website: a plain HTML page on a **different origin** from the API (`http://localhost:3000`), so the browser applies CORS rules to everything the widget does.

1. Wait for `Server running successfully on port 3000` in the `docker compose up` output (the customer site is ready within seconds, but the API container can need up to a minute on a start), then open **http://localhost:5500** in a browser. If the widget has not appeared after 4 seconds, the page says so and tells you whether the API is reachable; reload once it is. The widget appears in the bottom-right corner as a small form (title, description and fields come from the widget's config). The page also shows both origins side by side and the one-line embed snippet it uses.
2. Fill in the form (the email field is required) and press the button. The widget replaces the form with a thank-you message, and the page prints `HTTP 201 (stored as submission #N)`.
3. Log in as the demo owner and look at the submission in the dashboard API:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"dev@flyrank.ai","password":"DemoPass123!"}' | jq -r '.token')
curl -s "http://localhost:3000/api/dashboard/submissions?widget_id=1&limit=1" -H "Authorization: Bearer $TOKEN" | jq
```

To show your own widget, create it through the API and open `http://localhost:5500/?widget=<its id>`.

**What the browser does on this page.** The widget sends a JSON `POST` to the API. Because the page and the API are on different origins and the body is JSON, the browser first sends an automatic `OPTIONS` preflight; the API answers `204` with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods` including `POST` and `Access-Control-Allow-Headers` including `Content-Type`, and caches the answer for 10 minutes (`Access-Control-Max-Age: 600`). The real response, including error responses such as `400` and `429`, also carries `Access-Control-Allow-Origin`, and `Retry-After` is exposed, so the page's code can read them. You can watch this in the browser's developer tools (Network tab).

**Widget form config.** The widget's `config` (set when creating or updating it) controls what is drawn:

| Key | Meaning |
|-----|---------|
| `title`, `description` | Heading and text above the form |
| `buttonText`, `successMessage` | Button label and the message shown after a successful submit |
| `fields` | Up to 10 fields, each `{ "name": "email", "label": "Email", "type": "text" \| "email" \| "textarea", "required": true }`. A plain string such as `"email"` is shorthand for a field with that name. Names must start with a letter and use letters, digits and underscores; `website` is reserved for the honeypot. With no usable fields the widget shows a single required email field. |

All text from the config is shown as plain text (never as HTML). The loader adds a hidden `website` field that people never see; bots that fill it are dropped silently (see [Protection](#protection-enrichment-and-safe-side-effects)). The server checks the submission's structure, size and types; it does not enforce a widget's `required` flags, which the browser form applies.

**Bundle versions.** Published loader versions never change, so they can be cached for a year: `/widget.v1.js` is the original card without a form and is kept for old embeds, and `/widget.v2.js` is the current loader. The unversioned `/widget.js` always serves the current version with a 60 second cache. The comments in the loader's source file (`src/widget/widget.v2.js`) are removed before it is served, which keeps the public file small.

## Owner dashboard API (authenticated)

The owner reads the submissions that arrived on their widgets, and basic analytics. Send `Authorization: Bearer <token>` (from `/api/auth/login`). Every route is also available under `/api/v1/admin/dashboard`. The tenant always comes from the verified token, and every query joins `submissions` to `widgets` and filters on the widget's `tenant_id`, so an owner can never read another owner's data. Asking for another owner's widget or submission returns `404`, exactly like one that does not exist.

| Method | Endpoint | Query parameters | Success |
|--------|----------|------------------|---------|
| `GET` | `/api/dashboard/submissions` | `widget_id`, `from`, `to`, `limit` (1-100, default 20), `offset` (default 0) | `200` `{ data: [ { id, widget_id, widget_name, payload, metadata, geo, created_at } ], pagination: { total, limit, offset } }`, newest first |
| `GET` | `/api/dashboard/submissions/:id` | none | `200` one submission, `404` if it is not the caller's |
| `GET` | `/api/dashboard/stats/widgets` | none | `200` `{ data: [ { widget_id, name, type, total_submissions, last_24h, last_7d, enriched_submissions, last_submission_at } ] }` for every widget the owner has, busiest first (widgets with no submissions show zeros) |
| `GET` | `/api/dashboard/stats/over-time` | `days` (1-365, default 30), `widget_id` | `200` `{ days, from, to, widget_id, total, data: [ { date, count } ] }` with one entry per UTC day, including days with zero submissions |
| `GET` | `/api/dashboard/stats/geo` | `days` (1-365, default all time), `widget_id` | `200` `{ total, widget_id, days, data: [ { country, country_code, count, percent } ] }`, largest first; submissions that could not be located are grouped as `Unknown` |

Notes:
- `from` and `to` are ISO dates or date-times such as `2026-10-04` or `2026-10-04T10:00:00Z`. `from` is inclusive and `to` is exclusive, except that a bare `to` date includes that whole day. All dates and day buckets are UTC.
- Errors: `401` missing, invalid, tampered or expired token; `400` invalid query value (`{ error: "Validation Failed", details: [{ field, message }] }`); `404` unknown or foreign widget or submission; `500` generic message (details only in the server log).

**Try it**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"password123"}' | jq -r '.token')

# The newest 5 submissions as a table
curl -s "http://localhost:3000/api/dashboard/submissions?limit=5" -H "Authorization: Bearer $TOKEN" \
  | jq -r '.data[] | [.id, .widget_name, (.geo.country // "Unknown"), .created_at] | @tsv'

# Per-widget statistics
curl -s http://localhost:3000/api/dashboard/stats/widgets -H "Authorization: Bearer $TOKEN" | jq

# Submissions per day for the last 7 days
curl -s "http://localhost:3000/api/dashboard/stats/over-time?days=7" -H "Authorization: Bearer $TOKEN" | jq -r '.data[] | [.date, .count] | @tsv'

# Where visitors come from
curl -s http://localhost:3000/api/dashboard/stats/geo -H "Authorization: Bearer $TOKEN" | jq
```

## Protection, enrichment and safe side effects

Three layers sit between "request arrives" and "row stored" on `POST /api/embed/submit`. Order of the pipeline: per-IP rate limit, JSON body parser, validation, honeypot, per-widget rate limit, widget check, geo enrichment, storage, confirmation email.

**Abuse protection**

- **Rate limiting** uses a token bucket: each visitor IP (and each widget) has a bucket of tokens, every request spends one, and tokens drip back in steadily. A burst larger than the bucket gets `429` with a `Retry-After` header, but the same visitor can submit again a moment later, and other visitors are never affected. Defaults: per IP a burst of 10 refilling 2 per second; per widget a burst of 30 refilling 5 per second. The per-IP limit runs before the body is parsed, so floods of malformed or oversized bodies are turned away cheaply. CORS preflight (`OPTIONS`) requests are not counted. The buckets live in server memory (single instance).
- **Honeypot.** If the form field `website` has any content, the submission is treated as spam: nothing is stored, and the bot receives a normal-looking `201` (without a `submission_id`), so it learns nothing.

**Enrichment with a fallback chain.** The visitor's IP (as the server sees it, never the client-claimed `metadata.ip_address`) is looked up with provider A (ip-api.com); if that fails or times out, provider B (ipapi.co) is tried. If both fail, the submission is stored anyway with `geo` empty. Private and local addresses are skipped in real mode because public services cannot locate them. The result is stored in `submissions.geo` (country, region, city, provider) and summarised in the `201` reply as `enrichment`.

**Safe side effect.** After a submission is stored, a confirmation email job is queued if the form contains an `email` field. It runs in the background with up to 3 attempts (delays 300 ms, 600 ms by default). If every attempt fails, an `ALERT` line is written to the server log, and the visitor's `201` is unaffected. The email provider is simulated: a log line with the address masked.

### Test controls (development only)

With `TEST_CONTROLS=true` (the default in `.env.example` and `docker-compose.yml`) a request can force the failure cases that are hard to trigger on demand. With `TEST_CONTROLS=false` these headers are ignored.

| Header | Effect for that one request |
|--------|------------------------------|
| `X-Test-Geo-Down: a` | Geo provider A answers "down", so provider B is used |
| `X-Test-Geo-Down: a,b` | Both providers are "down", so the submission is stored without geo |
| `X-Test-Notify-Fail: true` | The confirmation email fails on every attempt, so the `ALERT` appears in the log |
| `X-Test-Client-Ip: 198.51.100.7` | Pretend to be a different visitor (for rate-limit tests from one machine) |

`GEO_MODE=mock` uses two built-in providers (`mock-a`, `mock-b`) so results are repeatable offline. Set `GEO_MODE=real` to use the real free services; they only locate public IP addresses, so combine it with `X-Test-Client-Ip: 8.8.8.8` when trying it from your own machine.

**Try each behaviour by hand**

```bash
URL=http://localhost:3000/api/embed/submit

# Provider A down: provider B answers
curl -s -X POST $URL -H "Content-Type: application/json" -H "X-Test-Geo-Down: a" -d '{"widget_id":1,"data":{"name":"Demo"}}'

# Both providers down: still stored, enrichment unavailable
curl -s -X POST $URL -H "Content-Type: application/json" -H "X-Test-Geo-Down: a,b" -d '{"widget_id":1,"data":{"name":"Demo"}}'

# Confirmation email fails: still 201; then look for the ALERT line
curl -s -X POST $URL -H "Content-Type: application/json" -H "X-Test-Notify-Fail: true" -d '{"widget_id":1,"data":{"email":"demo@example.com"}}'
docker compose logs --no-log-prefix --since 1m app | grep ALERT

# Honeypot filled in like a bot: 201 but nothing stored (no submission_id)
curl -s -X POST $URL -H "Content-Type: application/json" -d '{"widget_id":1,"data":{"name":"Bot","website":"http://spam.example"}}'

# Burst of 40 requests: the first ones return 201, the rest 429
seq 1 40 | xargs -P 20 -I @@ curl -s -o /dev/null -w '%{http_code}\n' -X POST $URL -H "Content-Type: application/json" -d '{"widget_id":1,"data":{"note":"burst"}}' | sort | uniq -c
```

### Health

`GET /health` returns `200 { "status": "ok", "timestamp": "..." }`.

---

## Testing

Each stage has an integration script. Start the app first (`docker compose up`), then in a second terminal run:

```bash
bash test_stage_1.sh   # register/login, auth rejection, CRUD, tenant isolation
bash test_stage_2.sh   # embed snippet generation
bash test_stage_3.sh   # versioned bundle, cache headers, config endpoint, loader safety
bash test_stage_4.sh   # CORS preflight, submission, validation, 404, oversized payload, malformed JSON, JSON 404
bash test_stage_5.sh   # honeypot, geo fallback chain, email failure, per-IP and per-widget rate limits
bash test_stage_6.sh   # dashboard login, list and paging, filters, tenant isolation, analytics
bash test_stage_7.sh   # second-origin customer site, widget bundle v2, CORS preflight and responses, submission visible in the dashboard
```

| Script | Covers |
|--------|--------|
| `test_stage_1.sh` | Register, duplicate/short-password rejection, login, wrong password; no header, made-up Bearer string, `x-tenant-id` header and tampered token all return `401`; create/list/update/delete widget; tenant B gets `404` when reading, updating or deleting tenant A's widget and the widget is left unchanged |
| `test_stage_2.sh` | `embed_snippet` present on create and fetch, bound to the right widget id and versioned URL |
| `test_stage_3.sh` | `/widget.v1.js` (the frozen first version) status, content type and immutable cache; config endpoint headers; `400`/`404` handling; unknown version `404`; legacy URL short cache; snippet uses the versioned URL; loader sets widget text with `textContent`, never `innerHTML` |
| `test_stage_7.sh` | The customer test site answers on port 5500 and embeds the API-hosted `widget.v2.js` (a different origin from the API); the v2 bundle is `immutable`, under 10 KB, free of comments, uses `textContent` and never `innerHTML`; version 1 is still served and differs from version 2; the unversioned URL serves the current version; the CORS preflight returns `204` allowing the origin, `POST`, `Content-Type` and a 10 minute cache; the success, `400`, `404`, malformed-JSON and `429` responses all carry `Access-Control-Allow-Origin` (and `429` carries an exposed `Retry-After`); a submission sent as the page sends it is stored and appears first in the demo owner's dashboard with the second-origin page address and geo data, while a honeypot submission is not stored |
| `test_stage_6.sh` | The dashboard rejects missing, made-up and tampered tokens; owner A's list returns exactly their submissions, newest first, with paging, widget and date filters; bad query values return `400`; owner B cannot list, fetch by id, or filter by owner A's data (`404`) and sees only their own; per-widget stats, counts over time (zero-count days included) and the geo breakdown return the expected numbers and percentages; a new public submission appears at the top of its owner's dashboard and stays hidden from the other owner |
| `test_stage_5.sh` | Honeypot spam is dropped and not stored while a normal submission is stored; geo provider A answers, then provider B when A is down, then the submission is stored without geo when both are down; a working confirmation email is sent and a failing one still returns `201`, stores the row and raises an `ALERT`; a burst from one visitor gets `429` while another visitor and `/health` are still served and the same visitor recovers after 2 seconds; a flood of 60 different visitors on one widget gets `429` while another widget is still served |
| `test_stage_4.sh` | Preflight `204`, valid submission `201`, missing data `400`, unknown widget `404`, oversized body `413` as JSON, malformed JSON `400` as JSON, unknown route `404` as JSON |

Raw outputs are pasted in [`EVIDENCE.md`](EVIDENCE.md). Design decisions, where AI helped and where it was wrong are in [`BUILDLOG.md`](BUILDLOG.md).

---

## Completed stages

| Stage | What was built | Verified by |
|-------|----------------|-------------|
| **1. Widget management API** | Tenant registration and login, signed JWT authentication, full widget CRUD, tenant isolation on every query | `test_stage_1.sh` |
| **2. Embed snippet generation** | Every widget response includes a ready-to-paste `<script>` embed snippet | `test_stage_2.sh` |
| **3. Fast, cached widget delivery** | Versioned widget bundle (`/widget.v1.js`, cached for a year), public config endpoint (cached for 60 s), CORS, `no-store` on error responses, loader that renders widget text as plain text | `test_stage_3.sh` |
| **7. Second-origin customer site and widget form** | A plain HTML customer page on a second origin (nginx, port 5500), widget loader version 2 that draws a form from the widget config, includes the honeypot and submits across origins, frozen older bundle versions, CORS preflight caching, a seeded demo owner | `test_stage_7.sh` |
| **6. Owner dashboard API** | Authenticated, tenant-isolated submissions list with paging and filters, a single-submission lookup, per-widget stats, counts over time and a geo breakdown | `test_stage_6.sh` |
| **5. Protection, enrichment and safe side effects** | Per-IP and per-widget rate limiting (`429`), honeypot spam control, geo enrichment with an A-then-B fallback chain that still stores the submission when every provider is down, background confirmation email with retries and a failure alert that never breaks the submission | `test_stage_5.sh` |
| **4. Public submission endpoint** | Cross-origin submissions with CORS and preflight, Zod input validation, widget existence check, storage in PostgreSQL, oversized-payload rejection, JSON error responses (global error handler) | `test_stage_4.sh` |

---

## Limitations

Honest notes on the current state of the project:

- **The widget UI is minimal.** The loader script shows a card with the widget's title and button. It does not collect or send form data itself; submissions are sent to `POST /api/embed/submit`.
- **Body limit is 10 KB.** It is set in `server.js` (`express.json({ limit: '10kb' })`); the `test_stage_4.sh` oversized-body check sends a larger body and expects a JSON `413`.
- **`schema.sql` is a single development script.** It drops and recreates the tables, and Docker runs it only when the database volume is new.
- **Login tokens expire** (default 1 hour). There is no refresh token, logout or password reset.
- **The demo owner's password is public** (`DemoPass123!`, shown in this README) and exists only so the demo can be followed locally; do not use the seed file for a real deployment.
- **The server does not enforce a widget's `required` flags.** The browser form applies them, but a direct request to the API only has to satisfy the submission's structure, size and type rules.
- **The widget form is minimal:** one fixed-position card in the bottom-right corner with text, email and multi-line fields, and no styling options. The loader (about 7 KB uncompressed) is not minified beyond removing comments and whitespace.
- **Rate limit buckets and queued confirmation emails live in server memory.** They reset (and queued emails are lost) when the server restarts, and they are not shared between several server instances.
- **Geo lookups:** the default `GEO_MODE=mock` returns fixed fake locations. With `GEO_MODE=real` only public IP addresses can be located, and the free provider tiers have request quotas.
- **The confirmation email is simulated** (a masked log line); no real mail is sent.
- **`TEST_CONTROLS=true` is for development only.** It lets any caller force provider or email failures for their own request and pretend to be another IP, so it must be `false` in production.
- **Dashboard times are UTC.** Counts over time are grouped by UTC day, and the submissions list returns each submission's form content exactly as it was stored.
- **Intended for local development** with Docker Compose.
