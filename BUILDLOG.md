Build & AI Usage Log 

Stage 1: Widget Management API 

What AI Helped With 
Generated initial Express middleware for JWT verification (authenticateTenant). 

Structured multi-tenant PostgreSQL queries using WHERE id = $1 AND tenant_id = $2. 

Formatted automated Bash verification script (test_stage_1.sh). 

Adjustments & Fixes Made 
Enforced strict cascade deletion on widget_fields when widgets are deleted. 

Standardized error response structure across all routes to return { "error": "message" }. 

Verified password hashing using bcryptjs for all registered tenant accounts.