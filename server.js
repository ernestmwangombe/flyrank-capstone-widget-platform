// ==============================================================================
// FlyRank Capstone - Full Architecture: Stages 1, 2, 3 & 4
// Integrated Express Server & Route Configuration (server.js)
// FIX: real authentication restored (register, login, signed JWT) + full widget CRUD
// ==============================================================================

// Import core Express web framework
import express from 'express';

// Import CORS middleware to enable cross-origin requests from embedded widgets
import cors from 'cors';

// Import dotenv to load environment variables from .env file
import dotenv from 'dotenv';

// FIX: import bcryptjs (pure JavaScript, no native build step needed on Alpine Docker images) to hash passwords
import bcrypt from 'bcryptjs';

// FIX: import jsonwebtoken to sign and verify the tenant login tokens
import jwt from 'jsonwebtoken';

// Import database connection pool module
import pool from './db.js';

// Import Stage 4 submission router module
import submissionRoutes from './src/routes/submission.js';

// Import Stage 5 per-IP rate limiter (the per-widget limiter lives inside the submission route)
import { ipRateLimiter } from './src/middleware/rateLimiter.js';

// Load environment variables into process.env
dotenv.config();

// FIX: read the JWT signing secret once, so every sign/verify call uses the same value
const JWT_SECRET = process.env.JWT_SECRET;

// FIX: refuse to start without a secret, because tokens signed with an empty secret are forgeable
if (!JWT_SECRET) {
  // Print a clear startup error that names the missing variable
  console.error('[CONFIG ERROR] JWT_SECRET is not set. Add it to .env or docker-compose.yml.');
  // Exit with a non-zero status code so Docker/nodemon shows the failure
  process.exit(1);
}

// FIX: how long a login token stays valid (override with JWT_EXPIRES_IN in .env)
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

// FIX: bcrypt work factor; 10 rounds is the common default balance of speed and security
const BCRYPT_ROUNDS = 10;

// FIX: pre-computed hash used to keep login timing similar when the email does not exist
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

// FIX (Stage 3): current widget bundle version; change WIDGET_VERSION in .env (or edit the fallback '1') on each release so the bundle URL changes
const WIDGET_VERSION = /^\d+$/.test(process.env.WIDGET_VERSION || '') ? process.env.WIDGET_VERSION : '1';

// Initialize Express application instance
const app = express();

// Set target server listening port from environment or fallback to 3000
const PORT = process.env.PORT || 3000;

// Attach database connection pool to Express app instance for global access
app.locals.pool = pool;

// Enable CORS for all routes to permit embedded widget cross-origin network calls
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // FIX: x-tenant-id removed from the allowed headers because tenant identity now comes only from the signed token
  allowedHeaders: ['Content-Type', 'Authorization'],
  // FIX (Stage 5): let browser code on other origins read the Retry-After header that comes with a 429 response
  exposedHeaders: ['Retry-After']
}));

// FIX (Stage 5): per-IP rate limit for the whole public /api/embed path.
// It sits BEFORE the JSON body parser on purpose, so a flood is turned away (429) before any body is read or parsed.
// CORS preflight (OPTIONS) requests are skipped inside the limiter.
app.use('/api/embed', ipRateLimiter);

// Enable JSON middleware to parse incoming JSON payloads with a strict size limit
app.use(express.json({ limit: '10kb' }));

// Explicitly handle CORS preflight OPTIONS requests for the submission endpoint
app.options('/api/embed/submit', (req, res) => {
  return res.sendStatus(204);
});

// Mount Stage 4 Submission Routes under /api/embed base path
app.use('/api/embed', submissionRoutes);

// Variable to store the running HTTP server reference
let server;

/**
 * Executes connection attempt loop to handle transient PostgreSQL boot delays.
 */
async function connectWithRetry(maxRetries = 5, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let client;
    try {
      console.log(`[DB CHECK] Attempting connection to PostgreSQL (Attempt ${attempt}/${maxRetries})...`);
      client = await pool.connect();
      const result = await client.query('SELECT NOW() AS current_time;');
      console.log(`[DB SUCCESS] Connected to PostgreSQL. Server time: ${result.rows[0].current_time}`);
      return; // Exit retry loop on successful connection
    } catch (error) {
      console.error(`[DB ERROR] Connection attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) {
        throw error; // Rethrow on final attempt to trigger fatal shutdown
      }
      // Pause execution before attempting reconnect
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      if (client) {
        client.release(); // Release client connection handle back to pool
      }
    }
  }
}

async function startSystem() {
  try {
    // 1. Validate Database Connectivity First with retry resiliency
    await connectWithRetry();

    // 2. Start HTTP Server only after DB verification succeeds
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running successfully on port ${PORT}`);
    });

    // Prevent Node process exit by explicitly setting keepAliveTimeout handle on server socket
    server.keepAliveTimeout = 60000;

  } catch (error) {
    // Robust error reporting to catch full stack traces
    console.error('[DB ERROR] Failed startup check after retry attempts:');
    console.error(error.stack || error);
    // Exit with non-zero status to signify fatal startup failure
    process.exit(1);
  }
}

// ==============================================================================
// PROCESS & EVENT LOOP DIAGNOSTICS
// Monitors process exit events and unhandled rejections to prevent silent stops
// ==============================================================================

process.on('exit', (code) => {
  console.log(`[PROCESS LIFECYCLE] Node process exiting with exit code: ${code}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[PROCESS ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[PROCESS ERROR] Uncaught Exception thrown:', err);
});

process.on('SIGINT', () => {
  console.log('\n[SHUTDOWN] Terminating server gracefully...');
  if (server) {
    server.close(() => {
      pool.end(() => {
        console.log('[SHUTDOWN] Closed all pools and listeners.');
        process.exit(0);
      });
    });
  } else {
    pool.end(() => {
      process.exit(0);
    });
  }
});

// ==============================================================================
// HELPER / TRANSFORMER FUNCTIONS
// ==============================================================================

const formatWidgetResponse = (widget, req) => {
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;

  let parsedConfig = widget.config;
  if (typeof widget.config === 'string') {
    try {
      parsedConfig = JSON.parse(widget.config);
    } catch (e) {
      parsedConfig = {};
    }
  }

  return {
    id: widget.id,
    tenant_id: widget.tenant_id,
    name: widget.name,
    type: widget.type,
    config: parsedConfig,
    created_at: widget.created_at,
    // FIX (Stage 3): the snippet now points at the versioned bundle URL, e.g. /widget.v1.js
    embed_snippet: `<script src="${baseUrl}/widget.v${WIDGET_VERSION}.js?id=${widget.id}" defer></script>`
  };
};

// FIX: convert a URL id string into a positive integer, or null when it is not one (blocks "abc", "1abc", "0", "-5")
const parseId = (raw) => {
  // Number() rejects strings like "1abc" (NaN), unlike parseInt() which would accept them as 1
  const value = Number(raw);
  // Only whole numbers greater than zero are valid SERIAL ids
  return Number.isInteger(value) && value > 0 ? value : null;
};

// FIX: check that a value is a plain JSON object (not null, not an array, not a string)
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// ==============================================================================
// FIX: AUTHENTICATION ROUTES (REGISTER & LOGIN)
// Mounted on /api/auth/* (used by test_stage_1.sh) and /api/v1/admin/* (used by capstone.yaml)
// ==============================================================================

// Handler: create a new tenant account with a hashed password
const registerHandler = async (req, res) => {
  try {
    // Read the three required fields from the JSON body (empty object if the body is missing)
    const { email, password, company_name } = req.body || {};

    // Reject requests where any field is missing or is not a string
    if (typeof email !== 'string' || typeof password !== 'string' || typeof company_name !== 'string') {
      return res.status(400).json({ error: 'Missing required fields: email, password and company_name' });
    }

    // Normalize the email so "A@x.com" and "a@x.com " are treated as the same account
    const cleanEmail = email.trim().toLowerCase();

    // Remove surrounding spaces from the company name
    const cleanCompany = company_name.trim();

    // Reject emails that do not look like name@domain.tld, or that are unreasonably long
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 255) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }

    // Reject empty or oversized company names (column is VARCHAR(255))
    if (cleanCompany.length === 0 || cleanCompany.length > 255) {
      return res.status(400).json({ error: 'company_name must be between 1 and 255 characters' });
    }

    // Enforce password length: 8 minimum, 72 maximum because bcrypt only reads the first 72 bytes
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'password must be between 8 and 72 characters' });
    }

    // Hash the password with a random salt; the plain text is never stored or logged
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Insert the new tenant and return only the safe columns (never the hash)
    const result = await pool.query(
      `INSERT INTO tenants (email, password_hash, company_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, company_name, created_at`,
      [cleanEmail, passwordHash, cleanCompany]
    );

    // Send 201 Created with the new tenant profile
    return res.status(201).json(result.rows[0]);

  } catch (err) {
    // PostgreSQL error code 23505 means a UNIQUE constraint failed, so this email already exists
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    // Keep the full error in the server log only
    console.error('Error registering tenant:', err.message);
    // Send a generic message so database details never reach the caller
    return res.status(500).json({ error: 'Registration failed' });
  }
};

// Handler: verify credentials and return a signed JWT
const loginHandler = async (req, res) => {
  try {
    // Read credentials from the JSON body (empty object if the body is missing)
    const { email, password } = req.body || {};

    // Reject requests where email or password is missing or not a string
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Missing required fields: email and password' });
    }

    // Normalize the email the same way registration did
    const cleanEmail = email.trim().toLowerCase();

    // Look up the tenant by email
    const result = await pool.query(
      'SELECT id, email, company_name, password_hash FROM tenants WHERE email = $1',
      [cleanEmail]
    );

    // Pick the real hash if the tenant exists, otherwise the dummy hash so timing does not reveal which emails exist
    const tenant = result.rows[0];
    const hashToCheck = tenant ? tenant.password_hash : DUMMY_HASH;

    // Compare the submitted password against the stored hash
    const passwordMatches = await bcrypt.compare(password, hashToCheck);

    // Same message for "no such email" and "wrong password" so attackers cannot probe for accounts
    if (!tenant || !passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Sign a token that carries only the tenant id; the secret and expiry come from the settings above
    const token = jwt.sign({ tenant_id: tenant.id }, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: JWT_EXPIRES_IN
    });

    // Send 200 OK with the token and a safe tenant profile
    return res.status(200).json({
      token: token,
      tenant: { id: tenant.id, email: tenant.email, company_name: tenant.company_name }
    });

  } catch (err) {
    // Keep the full error in the server log only
    console.error('Error logging in tenant:', err.message);
    // Send a generic message so database details never reach the caller
    return res.status(500).json({ error: 'Login failed' });
  }
};

// Register both auth routes under both prefixes (Express accepts an array of paths)
app.post(['/api/auth/register', '/api/v1/admin/register'], registerHandler);
app.post(['/api/auth/login', '/api/v1/admin/login'], loginHandler);

// ==============================================================================
// AUTHENTICATION & MULTI-TENANT MIDDLEWARE
// FIX: only a valid, unexpired JWT signed with JWT_SECRET is accepted.
// The old version trusted any 'x-tenant-id' header or any Bearer string as the tenant id.
// ==============================================================================

const authenticateTenant = (req, res, next) => {
  // Read the Authorization header, or an empty string if it is absent
  const authHeader = req.headers['authorization'] || '';

  // Split "Bearer <token>" into its two parts
  const [scheme, token] = authHeader.split(' ');

  // Reject requests that do not use the Bearer scheme or have no token
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed Authorization header' });
  }

  try {
    // Verify the signature and expiry; the algorithms list blocks "alg: none" token tricks
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    // Make sure the token actually carries a numeric tenant id
    if (!Number.isInteger(payload.tenant_id)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token payload' });
    }

    // Store the verified tenant id on the request; every query below filters by it
    req.tenantId = payload.tenant_id;

    // Hand control to the next handler
    return next();
  } catch (err) {
    // Covers forged, tampered, malformed and expired tokens alike
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

// ==============================================================================
// HEALTH & DIAGNOSTIC ROUTES
// ==============================================================================

app.get('/health', (req, res) => {
  return res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==============================================================================
// API ROUTES (STAGE 1 & STAGE 2 - PROTECTED MANAGEMENT ENDPOINTS)
// Mounted on both /api/widgets and /api/v1/admin/widgets for spec compliance
// ==============================================================================

const createWidgetHandler = async (req, res) => {
  try {
    // Read the widget fields from the JSON body (empty object if the body is missing)
    const { name, type, config } = req.body || {};

    // The name is required and must be a non-empty string
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Missing required field: name' });
    }

    // FIX: type is optional; test_stage_1.sh creates widgets without it, but the column is NOT NULL, so default it
    const widgetType = type === undefined ? 'lead_capture' : type;

    // If a type was supplied it must be a non-empty string that fits VARCHAR(100)
    if (typeof widgetType !== 'string' || widgetType.trim().length === 0 || widgetType.length > 100) {
      return res.status(400).json({ error: 'type must be a non-empty string up to 100 characters' });
    }

    // Config is optional and defaults to an empty object
    const configData = config === undefined ? {} : config;

    // If a config was supplied it must be a JSON object (not an array, string or null)
    if (!isPlainObject(configData)) {
      return res.status(400).json({ error: 'config must be a JSON object' });
    }

    // Insert the widget; tenant_id comes from the verified token, never from the request body
    const query = `
      INSERT INTO widgets (tenant_id, name, type, config)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING *
    `;

    // Run the insert with the values bound as parameters (blocks SQL injection)
    const result = await pool.query(query, [req.tenantId, name.trim(), widgetType.trim(), JSON.stringify(configData)]);
    const createdWidget = result.rows[0];
    const formattedWidget = formatWidgetResponse(createdWidget, req);

    return res.status(201).json(formattedWidget);

  } catch (err) {
    // Keep the full error in the server log only
    console.error('Error creating widget:', err.message);
    // FIX: generic message so database details never reach the caller
    return res.status(500).json({ error: 'Database operation failed' });
  }
};

const getWidgetsHandler = async (req, res) => {
  try {
    // Only the authenticated tenant's own widgets are returned
    const query = `SELECT * FROM widgets WHERE tenant_id = $1 ORDER BY id DESC`;
    const result = await pool.query(query, [req.tenantId]);
    const formattedWidgets = result.rows.map((row) => formatWidgetResponse(row, req));

    return res.status(200).json(formattedWidgets);

  } catch (err) {
    console.error('Error fetching widgets:', err.message);
    return res.status(500).json({ error: 'Database query failed' });
  }
};

const getWidgetByIdHandler = async (req, res) => {
  try {
    // FIX: validate the id strictly instead of passing raw text to the database
    const widgetId = parseId(req.params.id);
    if (widgetId === null) {
      return res.status(400).json({ error: 'Invalid widget ID format' });
    }

    // The tenant_id filter is what enforces isolation: another tenant's widget simply "does not exist" here
    const query = `SELECT * FROM widgets WHERE id = $1 AND tenant_id = $2`;
    const result = await pool.query(query, [widgetId, req.tenantId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Widget not found or unauthorized' });
    }

    const widget = result.rows[0];
    const formattedWidget = formatWidgetResponse(widget, req);

    return res.status(200).json(formattedWidget);

  } catch (err) {
    console.error('Error fetching widget by ID:', err.message);
    return res.status(500).json({ error: 'Database query failed' });
  }
};

// FIX: new handler for PUT (update); the capstone Stage 1 requires full CRUD
const updateWidgetHandler = async (req, res) => {
  try {
    // Validate the id from the URL
    const widgetId = parseId(req.params.id);
    if (widgetId === null) {
      return res.status(400).json({ error: 'Invalid widget ID format' });
    }

    // Read the fields that may be updated (empty object if the body is missing)
    const { name, type, config } = req.body || {};

    // At least one updatable field must be supplied
    if (name === undefined && type === undefined && config === undefined) {
      return res.status(400).json({ error: 'Provide at least one of: name, type, config' });
    }

    // If name is supplied it must be a non-empty string
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }

    // If type is supplied it must be a non-empty string that fits VARCHAR(100)
    if (type !== undefined && (typeof type !== 'string' || type.trim().length === 0 || type.length > 100)) {
      return res.status(400).json({ error: 'type must be a non-empty string up to 100 characters' });
    }

    // If config is supplied it must be a JSON object
    if (config !== undefined && !isPlainObject(config)) {
      return res.status(400).json({ error: 'config must be a JSON object' });
    }

    // COALESCE keeps the existing column value whenever the matching parameter is NULL (field not supplied)
    // The WHERE clause matches both id and tenant_id, so a tenant can only update its own widgets
    const query = `
      UPDATE widgets
      SET name = COALESCE($1, name),
          type = COALESCE($2, type),
          config = COALESCE($3::jsonb, config)
      WHERE id = $4 AND tenant_id = $5
      RETURNING *
    `;

    // Bind the values; undefined fields become NULL so COALESCE keeps the old value
    const result = await pool.query(query, [
      name === undefined ? null : name.trim(),
      type === undefined ? null : type.trim(),
      config === undefined ? null : JSON.stringify(config),
      widgetId,
      req.tenantId
    ]);

    // Zero rows means the widget does not exist or belongs to another tenant
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Widget not found or unauthorized' });
    }

    // Return the updated widget including its embed snippet
    return res.status(200).json(formatWidgetResponse(result.rows[0], req));

  } catch (err) {
    console.error('Error updating widget:', err.message);
    return res.status(500).json({ error: 'Database operation failed' });
  }
};

// FIX: new handler for DELETE; the capstone Stage 1 requires full CRUD
const deleteWidgetHandler = async (req, res) => {
  try {
    // Validate the id from the URL
    const widgetId = parseId(req.params.id);
    if (widgetId === null) {
      return res.status(400).json({ error: 'Invalid widget ID format' });
    }

    // Delete only if the widget belongs to the authenticated tenant; ON DELETE CASCADE removes its submissions
    const query = `DELETE FROM widgets WHERE id = $1 AND tenant_id = $2 RETURNING id`;
    const result = await pool.query(query, [widgetId, req.tenantId]);

    // Zero rows means the widget does not exist or belongs to another tenant
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Widget not found or unauthorized' });
    }

    // Confirm the deletion with the removed id
    return res.status(200).json({ message: 'Widget deleted successfully', id: result.rows[0].id });

  } catch (err) {
    console.error('Error deleting widget:', err.message);
    return res.status(500).json({ error: 'Database operation failed' });
  }
};

// Register Stage 1/2 routes under both route prefixes
app.post('/api/widgets', authenticateTenant, createWidgetHandler);
app.post('/api/v1/admin/widgets', authenticateTenant, createWidgetHandler);

app.get('/api/widgets', authenticateTenant, getWidgetsHandler);
app.get('/api/v1/admin/widgets', authenticateTenant, getWidgetsHandler);

app.get('/api/widgets/:id', authenticateTenant, getWidgetByIdHandler);
app.get('/api/v1/admin/widgets/:id', authenticateTenant, getWidgetByIdHandler);

// FIX: PUT and DELETE routes added under both prefixes
app.put('/api/widgets/:id', authenticateTenant, updateWidgetHandler);
app.put('/api/v1/admin/widgets/:id', authenticateTenant, updateWidgetHandler);

app.delete('/api/widgets/:id', authenticateTenant, deleteWidgetHandler);
app.delete('/api/v1/admin/widgets/:id', authenticateTenant, deleteWidgetHandler);

// ==============================================================================
// PUBLIC DELIVERY ROUTES (STAGE 3 - CACHED PUBLIC ENDPOINTS)
// FIX: the bundle is now served from a versioned URL (/widget.v1.js) that can be cached for a year safely,
// because a new release gets a new URL and browsers can never serve stale code from the old one.
// ==============================================================================

// FIX: helper that works out the public base URL (BASE_URL from .env, or the host the request came in on)
const getBaseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

// FIX: helper that builds the widget loader JavaScript text for a given base URL (shared by both routes below)
const buildWidgetScript = (baseUrl) => {
  // FIX (security): the card used to be built by joining the widget's title and button text into an HTML string and assigning it to innerHTML,
  // so a title such as <img src=x onerror=...> would have been run as markup on the customer's website.
  // The replacement lines inside the script below work like this (these notes live here, not inside the script, so the public file stays small):
  //   1. const card = document.createElement('div')        -> creates an empty card box in memory (no HTML parsing involved)
  //   2. card.style.cssText = '...'                         -> applies the same card styling as before
  //   3. const heading = document.createElement('h4')      -> creates the title element
  //   4. heading.style.cssText = '...'                      -> applies the same title styling as before
  //   5. heading.textContent = titleText                    -> puts the title in as PLAIN TEXT, so any <tags> in it are shown literally and never run
  //   6. const button = document.createElement('button')   -> creates the button element
  //   7. button.style.cssText = '...'                       -> applies the same button styling as before
  //   8. button.textContent = buttonText                    -> puts the button label in as PLAIN TEXT for the same reason
  //   9. card.appendChild(heading) / card.appendChild(button) -> places the title and button inside the card
  //  10. widgetContainer.appendChild(card)                  -> places the finished card inside the fixed-position container
  const widgetScript = `
    (function () {
      const currentScript = document.currentScript;
      
      if (!currentScript) {
        console.error('FlyRank Widget: Unable to resolve document.currentScript context.');
        return;
      }

      const scriptUrl = new URL(currentScript.src);
      const widgetId = scriptUrl.searchParams.get('id');

      if (!widgetId) {
        console.error('FlyRank Widget: Missing required "id" query parameter in embed snippet.');
        return;
      }

      fetch('${baseUrl}/api/widgets/' + widgetId + '/config')
        .then(function (response) {
          if (!response.ok) {
            throw new Error('HTTP error ' + response.status);
          }
          return response.json();
        })
        .then(function (data) {
          if (!data || !data.config) {
            console.error('FlyRank Widget: Invalid configuration structure returned.');
            return;
          }

          const widgetContainer = document.createElement('div');
          widgetContainer.id = 'flyrank-widget-' + widgetId;
          widgetContainer.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 999999; font-family: sans-serif;';

          const titleText = data.config.title || data.name || 'Widget';
          const buttonText = data.config.buttonText || 'Submit';

          const card = document.createElement('div');
          card.style.cssText = 'background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); width: 280px;';

          const heading = document.createElement('h4');
          heading.style.cssText = 'margin: 0 0 12px 0; color: #0f172a; font-size: 15px;';
          heading.textContent = titleText;

          const button = document.createElement('button');
          button.style.cssText = 'background: #2563eb; color: #ffffff; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; width: 100%; font-weight: bold;';
          button.textContent = buttonText;

          card.appendChild(heading);
          card.appendChild(button);
          widgetContainer.appendChild(card);

          document.body.appendChild(widgetContainer);
        })
        .catch(function (error) {
          console.error('FlyRank Widget Loader Error:', error);
        });
    })();
  `;

  // Trim leading/trailing whitespace and return the finished script text
  return widgetScript.trim();
};

// FIX: versioned bundle route; the regex matches /widget.v1.js, /widget.v2.js and so on, and captures the number
app.get(/^\/widget\.v(\d+)\.js$/, (req, res) => {
  // Read the version number captured from the URL
  const requestedVersion = req.params[0];

  // Only the current version exists; anything else is a 404 that must not be cached
  if (requestedVersion !== WIDGET_VERSION) {
    // Tell browsers and proxies never to store this error response
    res.setHeader('Cache-Control', 'no-store');
    // Respond with a JSON 404 that names the version that is available
    return res.status(404).json({ error: `Widget bundle version ${requestedVersion} not found. Current version is ${WIDGET_VERSION}.` });
  }

  // Allow any website to load this script
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Declare the response body as JavaScript
  res.setHeader('Content-Type', 'application/javascript');
  // Cache for one year and mark as immutable; safe because the URL changes whenever the code does
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  // Send the loader script built for this server's public base URL
  return res.send(buildWidgetScript(getBaseUrl(req)));
});

// FIX: the old unversioned URL still works so existing embed snippets keep running, but it is cached only briefly
app.get('/widget.js', (req, res) => {
  // Allow any website to load this script
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Declare the response body as JavaScript
  res.setHeader('Content-Type', 'application/javascript');
  // Short cache (60 seconds) and NOT immutable, so a new release reaches browsers quickly through this URL
  res.setHeader('Cache-Control', 'public, max-age=60');

  // Send the same loader script as the versioned route
  return res.send(buildWidgetScript(getBaseUrl(req)));
});

app.get('/api/widgets/:id/config', async (req, res) => {
  const { id } = req.params;

  const widgetId = parseInt(id, 10);
  if (isNaN(widgetId)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Invalid widget ID format' });
  }

  try {
    const query = `SELECT id, tenant_id, name, type, config, created_at FROM widgets WHERE id = $1`;
    const result = await pool.query(query, [widgetId]);

    if (result.rows.length === 0) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: `Widget with ID ${widgetId} not found` });
    }

    const widget = result.rows[0];

    let parsedConfig = widget.config;
    if (typeof widget.config === 'string') {
      try {
        parsedConfig = JSON.parse(widget.config);
      } catch (e) {
        parsedConfig = {};
      }
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=60');

    return res.status(200).json({
      id: widget.id,
      tenant_id: widget.tenant_id,
      name: widget.name,
      type: widget.type,
      config: parsedConfig,
      created_at: widget.created_at
    });

  } catch (err) {
    console.error(`[DB Error] GET /api/widgets/${id}/config failed:`, err);
    
    res.setHeader('Cache-Control', 'no-store');
    // FIX: the response no longer includes err.message (the full error is already logged above), so database details never reach the public
    return res.status(500).json({ error: 'Database query failed' });
  }
});

// ==============================================================================
// ERROR HANDLING
// FIX: every failure now returns a JSON body in the same { "error": "message" } shape as the rest of the API,
// instead of Express's default HTML error page. These two handlers MUST stay below every route above.
// ==============================================================================

// Catch-all handler: any request that matched no route above ends up here (a middleware with no path matches everything)
app.use((req, res) => {
  // Reply 404 Not Found with a JSON body (the message is fixed text, so nothing from the request is echoed back)
  return res.status(404).json({ error: 'Route not found' });
});

// Global error handler: Express calls a 4-argument middleware whenever body parsing or any route throws or calls next(err)
app.use((err, req, res, next) => {
  // If the response has already started streaming, we cannot send JSON anymore, so hand the error to Express's built-in handler
  if (res.headersSent) {
    // Delegate to the default handler, which closes the connection safely
    return next(err);
  }

  // body-parser sets err.type to 'entity.too.large' when the body is bigger than the express.json limit (10kb)
  if (err.type === 'entity.too.large') {
    // Reply 413 Payload Too Large with a clean JSON message
    return res.status(413).json({ error: 'Payload too large: request body exceeds the 10 KB limit' });
  }

  // body-parser sets err.type to 'entity.parse.failed' when the body is not valid JSON (for example a missing quote or brace)
  if (err.type === 'entity.parse.failed') {
    // Reply 400 Bad Request; the parser's own message is NOT sent back because it can reveal internal details
    return res.status(400).json({ error: 'Malformed JSON: request body could not be parsed' });
  }

  // body-parser sets these types when the client sends a body encoding or charset the server does not support
  if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    // Reply 415 Unsupported Media Type
    return res.status(415).json({ error: 'Unsupported request encoding or charset' });
  }

  // Any other client-side error that already carries a 4xx status (for example an aborted request) is passed through as a 400-level answer
  const status = err.status || err.statusCode;
  // Check that the status is a real 4xx client error
  if (status >= 400 && status < 500) {
    // Reply with that 4xx status and a generic message
    return res.status(status).json({ error: 'Bad request' });
  }

  // Anything left is an unexpected server fault: log the full details on the server only
  console.error('[Unhandled Error]:', err.stack || err);
  // Reply 500 with a generic message so database or code details never leak to the client
  return res.status(500).json({ error: 'Internal server error' });
});

// ==============================================================================
// START APPLICATION RUNTIME
// FIX: moved to the bottom so every route above is registered before the server begins listening
// ==============================================================================

// Start application runtime
startSystem();
