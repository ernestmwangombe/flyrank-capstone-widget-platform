# Stage 1 Execution & Verification Evidence

## Objective
Validate core authentication, CRUD operations, multi-tenant isolation, and database integration for the Widget Management Platform.

---


## Requirement 3: Embed Snippet Generation

### Overview
When a tenant creates or retrieves a widget, the API generates a deterministic client-side `<script>` snippet containing the unique widget identifier (`UUID` or primary key).

---
## API Protocol & Status Code Definitions

| Status Code | Definition | Usage Context |
| :--- | :--- | :--- |
| **200 OK** | Request processed successfully. | Used for successful logins, fetching widget lists, and deleting owned resources. |
| **201 Created** | New resource successfully persisted. | Returned upon tenant registration and new widget creation. |
| **400 Bad Request** | Invalid payload or missing fields. | Returned when client fails input schema validation. |
| **401 Unauthorized** | Missing or invalid auth token. | Returned when accessing protected admin endpoints without valid session headers. |
| **404 Not Found** | Resource missing or access denied. | Returned when requesting non-existent IDs or foreign tenant resources (Isolation Enforcement). |
| **500 Internal Error** | Backend operational failure. | Returned during unexpected server or database failures. |

---

## Requirement 3: Embed Snippet Generation

### Overview
When a tenant creates or retrieves a widget, the API generates a deterministic client-side `<script>` snippet containing the unique widget identifier (`UUID` or primary key).

### Snippet Specification

```html
<script src="http://localhost:3000/widget.js?id=<UUID>" defer></script>
```

## 1. Automated Test Suite Execution

### Execution Summary
- **Target URL:** `http://localhost:3000`
- **Script Executed:** `./test_stage_1.sh`
- **Result:** `ALL STAGE 1 TESTS PASSED SUCCESSFULLY!`

### Terminal Output
```text
==================================================
Starting Stage 1 Test Suite against http://localhost:3000
==================================================

1. Registering Tenant A...
[PASS] Tenant A Registration (Status: 201)

2. Logging in Tenant A...
[PASS] Tenant A Login (Status: 200)

3. Creating Widget as Tenant A...
[PASS] Create Widget (Tenant A) (Status: 201)

4. Fetching Widgets for Tenant A...
[PASS] Fetch Widgets (Tenant A) (Status: 200)

5. Registering & Logging in Tenant B...

6. Testing Multi-Tenant Isolation (Tenant B accessing Tenant A's Widget)...
[PASS] Multi-Tenant Isolation Verified (Tenant B rejected with status 404)

7. Deleting Widget as Tenant A...
[PASS] Delete Widget (Tenant A) (Status: 200)

==================================================
ALL STAGE 1 TESTS PASSED SUCCESSFULLY!
==================================================
