# Stage 2: Embed Snippet Generation — FlyRank Capstone

## Overview
Stage 2 extends the **FlyRank Widget Platform** backend to dynamically generate client-side integration snippets upon widget creation and retrieval. The generated snippet allows external tenant websites to embed hosted widgets seamlessly using asynchronous JavaScript injection.

---

## Architectural Objectives
- **Dynamic Snippet Formulation:** Construct standard `<script>` tag snippets bound to specific widget identifiers and environment configuration.
- **Tenant Context Preservation:** Ensure every generated snippet correlates accurately with its owner `tenant_id`.
- **Non-Blocking Delivery Strategy:** Utilise the `defer` script loading attribute to prevent parser-blocking on client sites.

---

## API Specifications

### 1. Create Widget
- **Endpoint:** `POST /api/widgets`
- **Headers:** `Content-Type: application/json`

#### Request Body
```json
{
  "tenant_id": "tenant_alpha_token_123",
  "name": "Stage 2 Lead Form",
  "type": "signup_form",
  "config": {
    "title": "Subscribe to Newsletter",
    "buttonText": "Submit"
  }
}