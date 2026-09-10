# FlyRank Capstone - Multi-Tenant Widget & Analytics Platform

A lightweight, high-performance backend platform built to manage multi-tenant embeddable web widgets, dynamically generate cross-origin script snippets, and serve cached configurations to third-party client websites with CDN-style performance.

## 🏗️ System Architecture

```mermaid
flowchart TD
    Client["Embedded Client Site\n(Third-Party Web)"]
    Server["Express API Server\n(Node.js / Express)"]
    DB[(PostgreSQL Database)]
    Bundle["Static Loader Bundle\n(public/widget.js)"]

    Client -- "1. GET /widget.js\nCache: public, max-age=31536000, immutable" --> Bundle
    Client -- "2. GET /api/widgets/:id/config\nCORS: *\nCache: public, max-age=60" --> Server
    Server -- "3. Query Config" --> DB
```

#    Architectural Data Flow

Static Loader Delivery: Third-party websites request GET /widget.js. The server responds with long-term immutable caching (Cache-Control: public, max-age=31536000, immutable).

Public Config API: The embedded script queries GET /api/widgets/:id/config. The server responds with open CORS (Access-Control-Allow-Origin: *) and short-term caching (Cache-Control: public, max-age=60).

Multi-Tenant Isolation: Tenant operations perform database lookups strictly isolated by tenant_id.

# 🚀 Completed Engineering Stages

## Stage 1: Multi-Tenant Widget Management API

Multi-Tenant Isolation: Enforced secure multi-tenancy using JWT authentication middleware (authenticateTenant). Queries filter strictly by WHERE id = $1 AND tenant_id = $2.

RESTful CRUD Operations: Developed endpoints for creating, reading, updating, and deleting widget configurations.

### Data Integrity: 
Configured PostgreSQL foreign key relationships with cascading deletes (ON DELETE CASCADE) to clean up child fields when widgets are removed.

## Defensive Error Handling: 
Standardized error payloads across all routes ({ "error": "message" }) with appropriate HTTP status codes (201, 200, 400, 404).

## Stage 2: Dynamic Embed Snippet Generation

- **Cross-Origin Script Tag Generation**: Integrated dynamic HTML embed snippet construction (`<script src=".../widget.js?id=X" defer></script>`).


-**Environment-Aware URLs:** Configured BASE_URL bindings to automatically format snippet source URLs based on the hosting environment.

-**Automatic Payload Injection:** Enhanced POST /api/widgets and GET /api/widgets/:id handlers to auto-inject the embed_snippet string into outgoing JSON responses.

## Stage 3: Fast, Cached Widget Delivery

-**CDN-Style Static Bundle Serving:** Created public endpoint GET /widget.js serving the static loader file with long-term immutable caching (Cache-Control: public, max-age=31536000, immutable).

-**Public Config Endpoint:** Created GET /api/widgets/:id/config with global CORS enabled (Access-Control-Allow-Origin: *) and short-term caching (Cache-Control: public, max-age=60).

-**Edge Cache Guardrails:** Added parameter parsing (parseInt). Non-numeric widget IDs return 400 Bad Request, and non-existent records return 404 Not Found with Cache-Control: no-store to prevent caching error states on downstream proxy caches.

# 📡 Complete API Contract Reference

## 1. Authenticated Management Routes

Requires header: Authorization: Bearer <tenant_jwt_token>

| Method | Endpoint | Status | Description |
| --- | --- | --- | --- |
| POST | /api/widgets | 201 Created | Create a new widget configuration and return embed snippet |
| GET | /api/widgets | 200 OK | Fetch all widgets belonging to the authenticated tenant |
| GET | /api/widgets/:id | 200 OK | Fetch a single widget configuration and embed snippet |
| PUT | /api/widgets/:id | 200 OK | Update configuration payload for a target widget |
| DELETE | /api/widgets/:id | 200 OK | Delete a widget record and cascade-drop field mappings |

### 2. Public Delivery Routes

*Public endpoints, CORS-enabled (`Access-Control-Allow-Origin: *`)*

| Method | Endpoint | Cache-Control Header | Description |
| --- | --- | --- | --- |
| `GET` | `/widget.js` | `public, max-age=31536000, immutable` | Serves the static JavaScript loader bundle |
| `GET` | `/api/widgets/:id/config` | `public, max-age=60` | Serves JSON config for embedding on client sites |

## ⚙️ Environment Configuration & Database Setup

**1. Environment File (.env)**

Create a .env file in the root directory:

PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/flyrank_capstone
JWT_SECRET=super_secret_jwt_key
BASE_URL=http://localhost:3000


**2. Run Database Seeding**

Execute the database setup script to apply migrations and seed test tenant data:

node setup_db.js


**3. Launch the Server**

node server.js


🧪 Automated Testing & Evidence Logs

The codebase includes automated Bash integration test scripts for each stage. Run them sequentially against a running server (http://localhost:3000):

## Test Stage 1: Authenticated CRUD Operations & Multitenancy
./test_stage_1.sh

## Test Stage 2: Embed Snippet Generation
./test_stage_2.sh

## Test Stage 3: Public Loader Serving, CORS & Cache Headers
./test_stage_3.sh


# Verification & Engineering Audit Logs

EVIDENCE.md: Contains raw execution outputs and pass/fail assertion checks for all test suites.

BUILDLOG.md: Logs architectural reasoning, security trade-offs, and implementation milestones.