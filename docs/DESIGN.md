# Design: Embeddable Widget & Lead-Capture Platform

> **Honest note on timing.** The brief asks for this one-page design at the start of the build. This version was written after Stage 7, from the code, schema and tests as they ended up, so it records the design as built (including changes made along the way, listed at the end). It was not written before the code.

## 1. Problem

A customer (a "tenant") creates a widget, pastes one `<script>` line on any website, and visitors' form submissions come back to this backend. Because those requests come straight from browsers the server does not control, input is never trusted: it is validated, rate limited, spam-filtered, enriched with location data and stored safely, and the owner reads it back through an authenticated dashboard API.

## 2. Three actors, three request paths

| Actor | Path | Auth | Notes |
|---|---|---|---|
| Widget owner | `/api/auth/*`, `/api/widgets/*`, `/api/dashboard/*` (also under `/api/v1/admin/`) | JWT | Tenant id always comes from the verified token |
| Customer website | `GET /widget.v<N>.js`, `GET /api/widgets/:id/config` | none | Public, CORS `*`, cached (bundle one year `immutable`, config 60 s) |
| Website visitor | `POST /api/embed/submit` (+ `OPTIONS` preflight) | none | Public, CORS, rate limited, validated |

## 3. Data model (PostgreSQL, `schema.sql`)

- **tenants**: `id`, `email` (unique), `password_hash` (bcrypt), `company_name`, `created_at`.
- **widgets**: `id`, `tenant_id` (FK, cascade), `name`, `type`, `config` (JSONB: title, description, fields, button text), `created_at`. Index on `tenant_id`.
- **submissions**: `id`, `widget_id` (FK, cascade), `payload` (JSONB form answers), `metadata` (JSONB, e.g. page URL), `geo` (JSONB or NULL), `idempotency_key` (optional), `created_at`. Indexes: `(widget_id, created_at DESC)` for newest-first lists and date windows, a GIN index on `payload`, and a partial unique index on `(widget_id, idempotency_key)` so a retried submission can only ever create one row.
- **Tenancy rule:** submissions have no tenant column; the tenant is reached through the widget. Every owner query joins `submissions` to `widgets` and filters on `widgets.tenant_id`, so isolation is enforced in the SQL, not in the UI.

## 4. API surface

- **Owner:** register, login, widget CRUD (create, list, get, update, delete), dashboard (submissions list with paging and filters, one submission, per-widget stats, counts over time, geo breakdown).
- **Public:** widget bundle (`widget.v1.js` and `widget.v2.js` frozen, `widget.v3.js` current, `widget.js` always the current one), widget config, health, submission (with an optional `Idempotency-Key` header).
- **Errors:** always JSON, `{ "error": "..." }` (validation adds `details`); unknown routes, malformed JSON and oversized bodies are `404`, `400` and `413`, never an HTML page and never a `500` for bad input.

## 5. Layers

HTTP (routes, middleware) -> logic (services) -> data (repositories, SQL).

- **Submission path and dashboard** follow all three layers: `src/routes/*`, `src/services/*`, `src/repositories/*`, with input validation in `src/middleware/*`.
- **Auth and widget CRUD** are still written inside `server.js` (only the login check was moved out to `src/middleware/authenticateTenant.js`). This is the one place the layering is incomplete.

## 6. Submission pipeline (the hardened path)

```
POST /api/embed/submit
  | per-IP token bucket           flood?  -> 429 (before the body is parsed)
  | JSON parse + size limit (10 KB)        -> 400 / 413
  | validation (Zod)                       -> 400
  | honeypot field filled?                -> dropped silently, looks like 201
  | per-widget token bucket        flood?  -> 429
  | widget exists?                         -> 404
  | Idempotency-Key used before?           -> same content: original answer again (replay, nothing re-sent); different content: 409
  | geo: provider A -> provider B -> store without geo (never fails)
  | store submission (unique on widget + key) -> 201
  | confirmation email queued in the background (retries, then an ALERT log line; never changes the 201)
```

## 7. Key decisions

- **Published widget bundles never change.** A changed loader ships as a new version (`widget.v2.js`) because bundle URLs are cached for a year; old versions stay available so old embeds keep working.
- **Own token-bucket rate limiter** (per IP and per widget) instead of a package: the behaviour is "a burst gets 429, a normal request moments later succeeds". State is in memory (single instance).
- **Geo fallback chain with mock providers by default** so the proof is repeatable offline; real ip-api.com and ipapi.co are one setting away (`GEO_MODE=real`).
- **Development-only test controls** (`TEST_CONTROLS=true`): headers that force a geo provider or the email to fail, and pretend to be another visitor IP. They must be off in production.
- **The loader never trusts owner-supplied config**: all text is set with `textContent`, field names are restricted, at most 10 fields.
- **Retry safety by idempotency key.** The widget sends a random key per submission; the server returns the original submission for a repeat of the same key and content, refuses the same key with different content (`409`), and lets the database enforce one row per widget and key, so even simultaneous retries create one row and one confirmation email.
- **Seed instead of migrations:** `schema.sql` drops and recreates the tables and inserts demo rows (a demo owner and one widget); Docker runs it automatically on a new database volume.

## 8. Explicit non-goal

**No browser-based admin interface.** Owners use the JSON API (the README shows `curl` and `jq` examples that print tables). The brief puts the grade in the backend, so there is no admin front end, no hosting, no domain and no real CDN or email provider.

## 9. What changed from the first plan, and known gaps

- The first widget loader only drew a title and a button; the form and cross-origin submit arrived in Stage 7 (bundle version 2).
- Real authentication was built in Stage 1, accidentally replaced by a placeholder in Stage 2, and restored later (see `BUILDLOG.md`).
- The idempotency key and widget bundle version 3 were added in Stage 8.
- Known gaps (also in the README's limitations): the server does not enforce a widget's `required` flags, rate-limit state and queued emails are lost on restart, idempotency keys never expire, there are no migrations, and auth and widget CRUD are not yet split into layers.
