# FlyRank Capstone - Build & AI Engineering Log

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

---

## Stage 3: Fast, Cached Widget Delivery
**Focus:** Public CDN-style asset distribution, HTTP Cache-Control header strategies, and defensive parameter validation.

### What AI Helped With
- Generated initial Express route definitions for serving static JavaScript bundles (`GET /widget.js`) and public JSON configurations (`GET /api/widgets/:id/config`).
- Drafted assertion tests for `test_stage_3.sh` using `curl -I` status code and header inspection flags.

### Adjustments & Fixes Made
- **Header Hardening:** Configured long-term immutable caching (`Cache-Control: public, max-age=31536000, immutable`) for `GET /widget.js` to simulate CDN edge delivery.
- **Dynamic Config Caching:** Implemented short-term caching (`Cache-Control: public, max-age=60`) and global CORS headers (`Access-Control-Allow-Origin: *`) on public widget config endpoints.
- **Defensive Error Handling:** Added parameter parsing (`parseInt`) on `GET /api/widgets/:id/config`. Non-numeric parameters return `400 Bad Request`, and missing records return `404 Not Found` paired with `Cache-Control: no-store` to prevent caching error states on downstream proxy caches.
- **Deterministic Test Seeding:** Updated `setup_db.js` to re-seed Tenant #1 and Widget #1 deterministically prior to running `test_stage_3.sh`.