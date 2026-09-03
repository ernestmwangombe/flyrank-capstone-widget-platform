// =============================================================================
// 1. ENVIRONMENT CONFIGURATION & DEPENDENCY IMPORTS
// =============================================================================

// Load environment variables from the root .env file into process.env immediately at runtime boot
require('dotenv').config();

// Import core Express web framework to handle HTTP request routing and middleware execution
const express = require('express');

// Import PostgreSQL client Pool class from 'pg' package for connection pooling
const { Pool } = require('pg');

// Import bcrypt library for CPU-intensive, salt-based password hashing
const bcrypt = require('bcrypt');

// Import JSON Web Token library for stateless user and tenant authentication
const jwt = require('jsonwebtoken');

// =============================================================================
// 2. APP INITIALIZATION & GLOBAL MIDDLEWARE STACK
// =============================================================================

// Instantiate the primary Express application object
const app = express();

// Set operational TCP port from system environment variable, defaulting to 3000
const PORT = process.env.PORT || 3000;

// Enable built-in JSON body-parsing middleware to populate req.body from raw incoming JSON payloads
app.use(express.json());

// Register global request logging middleware for operational visibility and audit tracking
app.use((req, res, next) => {
  // Log ISO timestamp, HTTP method (e.g. POST), and requested URL path to console
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  
  // Pass control to the next middleware or route handler in the execution stack
  next();
});

// =============================================================================
// 3. DATABASE CONNECTION POOL CONFIGURATION
// =============================================================================

// Instantiate PostgreSQL socket connection pool with defensive type casting and fallbacks
const pool = new Pool({
  // Hostname for database server loaded from process.env with 'localhost' fallback
  host: process.env.DB_HOST || 'localhost',
  
  // Database port cast strictly to numeric integer type with fallback to PostgreSQL default 5432
  port: Number(process.env.DB_PORT) || 5432,
  
  // Database access user account loaded from process.env with 'postgres' fallback
  user: process.env.DB_USER || 'postgres',
  
  // Database password explicitly cast to String primitive to satisfy PostgreSQL SCRAM SASL requirement
  password: String(process.env.DB_PASSWORD || ''),
  
  // Database name loaded from process.env with 'widget_platform' fallback
  database: process.env.DB_NAME || 'widget_platform',
});

// Verify active database connectivity during system boot phase
pool.connect()
  .then(client => {
    // Log successful PostgreSQL connection verification
    console.log('Successfully connected to PostgreSQL database!');
    
    // Release client socket back to the pool immediately after validation
    client.release();
  })
  .catch(err => {
    // Log database connection failure stack trace without halting server process execution
    console.error('Database connection error:', err.stack);
  });

  // =============================================================================
// 4. AUTHENTICATION MIDDLEWARE
// =============================================================================

/**
 * Middleware: Verify JWT Bearer Token
 * 
 * Extracts Authorization header, validates token signature, and attaches tenant claims to req.tenant
 */
const authenticateToken = (req, res, next) => {
  // Extract Authorization header value from incoming HTTP request
  const authHeader = req.headers['authorization'];
  
  // Split Bearer token string to isolate the raw JWT token payload
  const token = authHeader && authHeader.split(' ')[1];

  // Return HTTP 401 Unauthorized if no token was provided in headers
  if (!token) {
    return res.status(401).json({ error: 'Access token missing' });
  }

  // Verify token cryptographic signature using environment secret key
  jwt.verify(token, process.env.JWT_SECRET, (err, tenant) => {
    // Return HTTP 403 Forbidden if token signature is invalid or expired
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Attach decoded tenant payload object to request context for downstream route handlers
    req.tenant = tenant;
    
    // Proceed to next middleware or route handler execution
    next();
  });
};

// =============================================================================
// 5. API ROUTE HANDLERS
// =============================================================================

/**
 * ROUTE: Tenant Registration
 * PATH: POST /api/auth/register
 * 
 * Pipeline: Extract -> Validate -> Hash -> Insert -> Respond
 */
// Register asynchronous POST route callback for tenant account creation
app.post('/api/auth/register', async (req, res) => {
  // Extract email address safely using optional chaining from parsed request body
  const email = req.body?.email;
  
  // Extract plain-text password safely using optional chaining from parsed request body
  const password = req.body?.password;
  
  // Extract tenant name from 'name' or fallback to test-suite 'company_name' key
  const name = req.body?.name || req.body?.company_name;

  // Validate presence of all three mandatory parameter values
  if (!name || !email || !password) {
    // Halt execution with HTTP 400 Bad Request if any required field is missing
    return res.status(400).json({ 
      error: 'Missing required fields: name (or company_name), email, password' 
    });
  }

  try {
    // Set cost factor salt rounds for bcrypt algorithm (10 rounds = ~100ms calculation time)
    const saltRounds = 10;
    
    // Asynchronously generate salt and compute password hash without blocking event loop
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Execute parameterized SQL insert query to prevent SQL injection vulnerabilities
    const result = await pool.query(
      'INSERT INTO tenants (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, passwordHash]
    );

    // Return HTTP 201 Created containing newly inserted non-sensitive tenant record
    return res.status(201).json(result.rows[0]);

  } catch (err) {
    // Log execution failure details to standard error output stream
    console.error('Registration Error:', err);
    
    // Check for PostgreSQL unique constraint violation error code (23505 = unique_violation)
    if (err.code === '23505') {
      // Return HTTP 409 Conflict if tenant email is already registered in database
      return res.status(409).json({ error: 'Email already registered' });
    }
    
    // Return HTTP 500 Internal Server Error for unhandled runtime database exceptions
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ROUTE: Tenant Authentication Login
 * PATH: POST /api/auth/login
 * 
 * Pipeline: Extract -> Validate -> Query Database -> Verify Password -> Sign JWT -> Respond
 */
// Register asynchronous POST route handler for tenant authentication and token issuance
app.post('/api/auth/login', async (req, res) => {
  // Extract email address safely using optional chaining from parsed request body
  const email = req.body?.email;
  
  // Extract plain-text password safely using optional chaining from parsed request body
  const password = req.body?.password;

  // Validate that both mandatory credential fields are present in the payload
  if (!email || !password) {
    // Halt execution and return HTTP 400 Bad Request if credentials are incomplete
    return res.status(400).json({ error: 'Missing required fields: email, password' });
  }

  try {
    // Execute parameterized SQL query to fetch tenant record matching the supplied email
    const result = await pool.query('SELECT * FROM tenants WHERE email = $1', [email]);
    
    // Extract the first row from the query result set representing the target tenant
    const tenant = result.rows[0];

    // Return HTTP 401 Unauthorized if no tenant account exists with that email address
    if (!tenant) {
      // Security note: Generic error message prevents user enumeration attacks
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Asynchronously compare the submitted plain-text password against the stored secure bcrypt hash
    const isPasswordValid = await bcrypt.compare(password, tenant.password_hash);

    // Return HTTP 401 Unauthorized if the cryptographic verification fails
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate a cryptographically signed JSON Web Token containing non-sensitive tenant identity claims
    const token = jwt.sign(
      { id: tenant.id, email: tenant.email, name: tenant.name },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Return HTTP 200 OK along with the issued bearer token for subsequent authenticated requests
    return res.status(200).json({ token });

  } catch (err) {
    // Log unexpected server-side execution exceptions to standard error output
    console.error('Login Error:', err);
    
    // Return HTTP 500 Internal Server Error to client for unhandled runtime failures
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ROUTE: Create Widget
 * PATH: POST /api/widgets
 * 
 * Pipeline: Authenticate -> Extract Payload -> Validate -> Insert into DB -> Respond
 */
// Register authenticated POST route handler for creating widgets linked to the tenant
app.post('/api/widgets', authenticateToken, async (req, res) => {
  // Extract widget name/title from request body with fallback keys
  const widgetName = req.body?.name || req.body?.title;
  
  // Extract widget config/settings object with fallback to an empty object
  const widgetConfig = req.body?.config || req.body?.settings || {};

  // Validate presence of required widget name attribute
  if (!widgetName) {
    return res.status(400).json({ error: 'Missing required field: name' });
  }

  try {
    // Extract tenant ID from the verified token attached by the authentication middleware
    const tenantId = req.tenant.id;

    // Execute parameterized insert query into the widgets table
    const result = await pool.query(
      'INSERT INTO widgets (tenant_id, name, config) VALUES ($1, $2, $3) RETURNING id, tenant_id, name, config, created_at',
      [tenantId, widgetName, JSON.stringify(widgetConfig)]
    );

    // Return HTTP 201 Created with the newly created widget record
    return res.status(201).json(result.rows[0]);

  } catch (err) {
    // Log execution failure details to standard error output
    console.error('Widget Creation Error:', err);
    
    // Handle case where widgets table has not been created yet in PostgreSQL
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'Database schema error: widgets table missing' });
    }
    
    // Return HTTP 500 Internal Server Error for unhandled runtime exceptions
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ROUTE: Fetch Widgets for Authenticated Tenant
 * PATH: GET /api/widgets
 * 
 * Pipeline: Authenticate -> Query Database -> Respond
 */
app.get('/api/widgets', authenticateToken, async (req, res) => {
  try {
    // Extract authenticated tenant id from middleware token context
    const tenantId = req.tenant.id;

    // Execute parameterized query to fetch all widgets belonging to this tenant
    const result = await pool.query(
      'SELECT id, tenant_id, name, config, created_at FROM widgets WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );

    // Return HTTP 200 OK with the array of widget records
    return res.status(200).json(result.rows);

  } catch (err) {
    console.error('Fetch Widgets Error:', err);
    
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'Database schema error: widgets table missing' });
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ROUTE: Delete Widget by ID with Tenant Isolation
 * PATH: DELETE /api/widgets/:id
 * 
 * Pipeline: Authenticate -> Delete from Database with Tenant Scope -> Respond
 */
app.delete('/api/widgets/:id', authenticateToken, async (req, res) => {
  const widgetId = req.params.id;
  const tenantId = req.tenant.id;

  try {
    // Enforce tenant boundary scoping during deletion to prevent IDOR vulnerabilities
    const result = await pool.query(
      'DELETE FROM widgets WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [widgetId, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Widget not found' });
    }

    return res.status(200).json({ message: 'Widget deleted successfully', id: result.rows[0].id });

  } catch (err) {
    console.error('Delete Widget Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ROUTE: Fetch Single Widget by ID with Tenant Isolation
 * PATH: GET /api/widgets/:id
 * 
 * Pipeline: Authenticate -> Query Database with Tenant Scope -> Respond
 */
app.get('/api/widgets/:id', authenticateToken, async (req, res) => {
  const widgetId = req.params.id;
  const tenantId = req.tenant.id;

  try {
    // Parameterized query enforcing strict multi-tenant boundary isolation
    const result = await pool.query(
      'SELECT id, tenant_id, name, config, created_at FROM widgets WHERE id = $1 AND tenant_id = $2',
      [widgetId, tenantId]
    );

    // Return 404 if the widget does not exist or belongs to another tenant (prevents data leakage)
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Widget not found' });
    }

    return res.status(200).json(result.rows[0]);

  } catch (err) {
    console.error('Fetch Single Widget Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ROUTE: System Health Check
 * PATH: GET /health
 */
// Register health probe endpoint for container orchestrators or uptime monitors
app.get('/health', (req, res) => {
  // Return HTTP 200 OK status indicator
  res.status(200).json({ status: 'OK' });
});

// =============================================================================
// 6. CATCH-ALL & ERROR HANDLING MIDDLEWARE
// =============================================================================

// Catch-all route handler for requests that matched no prior valid endpoint
app.use((req, res) => {
  // Return HTTP 404 Not Found payload
  res.status(404).json({ error: 'Route not found' });
});

// =============================================================================
// 7. SERVER BOOTSTRAP
// =============================================================================

// Bind Express HTTP server to specified TCP port and begin accepting inbound connections
app.listen(PORT, () => {
  // Print operational status confirmation to terminal console
  console.log(`Server is running and listening on http://localhost:${PORT}`);
});