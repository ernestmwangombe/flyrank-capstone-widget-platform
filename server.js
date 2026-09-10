// ==============================================================================
// FlyRank Capstone - Stage 3: Fast, Cached Widget Delivery (server.js)
// PostgreSQL / pg Pool Integration & CDN-Like Caching
// ==============================================================================

// Load environment variables from .env file into process.env
require('dotenv').config();

// Import Express framework for routing and HTTP server handling
const express = require('express');

// Import CORS middleware to allow cross-origin requests from external sites
const cors = require('cors');

// Import PostgreSQL pool instance from local db module
const pool = require('./db');

// Initialize the Express application instance
const app = express();

// Set the network port from environment variables or default to 3000
const PORT = process.env.PORT || 3000;

// Enable JSON middleware to parse incoming application/json request bodies
app.use(express.json());

// Enable CORS middleware to allow external sites to talk to public endpoints
app.use(cors());

// ==============================================================================
// HELPER / TRANSFORMER FUNCTIONS
// Declared BEFORE route handlers so they are available in memory during execution
// ==============================================================================

/**
 * Transforms a raw database widget record into an API-compliant widget payload.
 * Appends the computed `embed_snippet` field dynamically based on host header.
 * 
 * @param {Object} widget - The raw widget record from PostgreSQL database
 * @param {Object} req - The Express HTTP request object (used for protocol/host)
 * @returns {Object} Cleaned widget object with computed embed_snippet
 */
const formatWidgetResponse = (widget, req) => {
  // Extract HTTP protocol (http or https) from incoming request
  const protocol = req.protocol;

  // Extract Host header (e.g., localhost:3000 or api.yourdomain.com)
  const host = req.get('host');

  // Determine base URL from environment setting or fall back to current request origin
  const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;

  // Ensure config is returned as a JSON object (pg parses JSONB automatically)
  let parsedConfig = widget.config;
  if (typeof widget.config === 'string') {
    try {
      parsedConfig = JSON.parse(widget.config);
    } catch (e) {
      parsedConfig = {}; // Fallback to empty object on parse failure
    }
  }

  // Return formatted object containing all DB fields plus calculated embed_snippet
  return {
    id: widget.id,                                      // Primary key of the widget
    tenant_id: widget.tenant_id,                        // Tenant owner identifier
    name: widget.name,                                  // Name of the widget
    type: widget.type,                                  // Type (e.g., signup_form, CTA, popover)
    config: parsedConfig,                               // Validated JSON config object
    created_at: widget.created_at,                      // Creation timestamp
    // Dynamic single-line script snippet for embedding on customer sites
    embed_snippet: `<script src="${baseUrl}/widget.js?id=${widget.id}" defer></script>`
  };
};

// ==============================================================================
// AUTHENTICATION & MULTI-TENANT MIDDLEWARE
// ==============================================================================

/**
 * Middleware to mock tenant authentication and enforce tenant isolation
 */
const authenticateTenant = (req, res, next) => {
  // Extract Authorization header from incoming HTTP request
  const authHeader = req.headers['authorization'];

  // Reject request if Authorization header is missing
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: Missing Authorization header' });
  }

  // Extract Bearer token string
  const token = authHeader.split(' ')[1];

  // Validate token existence
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token format' });
  }

  // Attach tenant context to request object based on token (Mock Auth rule)
  req.tenantId = token; // Using token directly as tenant identifier for development

  // Proceed to next middleware or route handler
  next();
};

// ==============================================================================
// API ROUTES (STAGE 1 & STAGE 2 - PROTECTED MANAGEMENT ENDPOINTS)
// ==============================================================================

/**
 * POST /api/widgets
 * Creates a new widget and returns 201 Created with the generated embed snippet
 */
app.post('/api/widgets', authenticateTenant, async (req, res) => {
  try {
    // Destructure payload properties from body
    const { name, type, config } = req.body;

    // Validate required inputs
    if (!name || !type) {
      return res.status(400).json({ error: 'Missing required fields: name and type' });
    }

    // Convert config object to JSON string if needed for storage
    const configData = config || {};

    // SQL Query to insert widget using PostgreSQL $1, $2, $3, $4 placeholders
    const query = `
      INSERT INTO widgets (tenant_id, name, type, config)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;

    // Execute parametrized query against PostgreSQL pool
    const result = await pool.query(query, [req.tenantId, name, type, configData]);

    // Extract created row from result set
    const createdWidget = result.rows[0];

    // Format response using helper to include dynamic embed_snippet
    const formattedWidget = formatWidgetResponse(createdWidget, req);

    // Return 201 Created status with formatted widget
    return res.status(201).json(formattedWidget);

  } catch (err) {
    // Catch database execution or runtime exceptions
    console.error('Error creating widget:', err.message);
    return res.status(500).json({ error: 'Database operation failed', details: err.message });
  }
});

/**
 * GET /api/widgets
 * Retrieves all widgets owned by authenticated tenant
 */
app.get('/api/widgets', authenticateTenant, async (req, res) => {
  try {
    // Query widgets filtered strictly by req.tenantId using $1 parameter
    const query = `SELECT * FROM widgets WHERE tenant_id = $1 ORDER BY id DESC`;

    // Execute query on PostgreSQL pool
    const result = await pool.query(query, [req.tenantId]);

    // Map each row through formatWidgetResponse helper to append embed_snippet
    const formattedWidgets = result.rows.map((row) => formatWidgetResponse(row, req));

    // Return 200 OK with formatted list
    return res.status(200).json(formattedWidgets);

  } catch (err) {
    console.error('Error fetching widgets:', err.message);
    return res.status(500).json({ error: 'Database query failed', details: err.message });
  }
});

/**
 * GET /api/widgets/:id
 * Retrieves a single widget by ID with tenant isolation verification
 */
app.get('/api/widgets/:id', authenticateTenant, async (req, res) => {
  try {
    // Extract ID parameter from request URL path
    const widgetId = req.params.id;

    // Query widget ensuring both ID ($1) and tenant_id ($2) match
    const query = `SELECT * FROM widgets WHERE id = $1 AND tenant_id = $2`;

    // Execute query on PostgreSQL pool
    const result = await pool.query(query, [widgetId, req.tenantId]);

    // Check if matching row exists
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Widget not found or unauthorized' });
    }

    // Extract target row
    const widget = result.rows[0];

    // Format response using helper to append embed_snippet
    const formattedWidget = formatWidgetResponse(widget, req);

    // Return 200 OK
    return res.status(200).json(formattedWidget);

  } catch (err) {
    console.error('Error fetching widget by ID:', err.message);
    return res.status(500).json({ error: 'Database query failed', details: err.message });
  }
});

// ==============================================================================
// PUBLIC DELIVERY ROUTES (STAGE 3 - CACHED PUBLIC ENDPOINTS)
// ==============================================================================

/**
 * GET /widget.js
 * Public static script delivery endpoint.
 * Serves client runner JavaScript with long-term cache headers (365 days).
 */
app.get('/widget.js', (req, res) => {
  // Set Cross-Origin Resource Sharing (CORS) header allowing embedding on any external domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Set explicit Content-Type header specifying JavaScript MIME type
  res.setHeader('Content-Type', 'application/javascript');
  // Set aggressive long-term HTTP Cache-Control header (1 year / 31536000 seconds)
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  // Dynamically resolve server origin for the client-side fetch call
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;

  // Client-side JavaScript runner execution payload
  const widgetScript = `
    (function () {
      // Obtain reference to the current <script> DOM element executing this bundle
      const currentScript = document.currentScript;
      
      // Guard check to ensure DOM script context exists
      if (!currentScript) {
        console.error('FlyRank Widget: Unable to resolve document.currentScript context.');
        return;
      }

      // Extract 'id' query parameter from script src URL (e.g. /widget.js?id=1)
      const scriptUrl = new URL(currentScript.src);
      const widgetId = scriptUrl.searchParams.get('id');

      // Reject execution if script tag lacks required widget ID parameter
      if (!widgetId) {
        console.error('FlyRank Widget: Missing required "id" query parameter in embed snippet.');
        return;
      }

      // Execute cross-origin fetch to public configuration endpoint
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

          // Create DOM container for floating widget UI
          const widgetContainer = document.createElement('div');
          widgetContainer.id = 'flyrank-widget-' + widgetId;
          widgetContainer.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 999999; font-family: sans-serif;';

          // Extract title and button text safely with fallbacks
          const titleText = data.config.title || data.name || 'Widget';
          const buttonText = data.config.buttonText || 'Submit';

          // Render card markup into container
          widgetContainer.innerHTML = 
            '<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); width: 280px;">' +
              '<h4 style="margin: 0 0 12px 0; color: #0f172a; font-size: 15px;">' + titleText + '</h4>' +
              '<button style="background: #2563eb; color: #ffffff; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; width: 100%; font-weight: bold;">' + buttonText + '</button>' +
            '</div>';

          // Inject rendered container into document body
          document.body.appendChild(widgetContainer);
        })
        .catch(function (error) {
          console.error('FlyRank Widget Loader Error:', error);
        });
    })();
  `;

  // Return JavaScript script payload
  return res.send(widgetScript.trim());
});

/**
 * GET /api/widgets/:id/config
 * Public configuration delivery endpoint.
 * Serves widget configuration JSON with short-term cache headers (60 seconds).
 */
app.get('/api/widgets/:id/config', async (req, res) => {
  const { id } = req.params;

  // 1. Validate parameter format
  const widgetId = parseInt(id, 10);
  if (isNaN(widgetId)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'Invalid widget ID format' });
  }

  try {
    // 2. Query public widget fields from PostgreSQL database
    const query = `SELECT id, tenant_id, name, type, config, created_at FROM widgets WHERE id = $1`;
    const result = await pool.query(query, [widgetId]);

    // 3. Return 404 if widget record does not exist
    if (result.rows.length === 0) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: `Widget with ID ${widgetId} not found` });
    }

    // Extract raw database record
    const widget = result.rows[0];

    // Ensure config is returned as a JSON object
    let parsedConfig = widget.config;
    if (typeof widget.config === 'string') {
      try {
        parsedConfig = JSON.parse(widget.config);
      } catch (e) {
        parsedConfig = {};
      }
    }

    // 4. Set headers and send response
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
    // Log complete error object to console for internal debugging
    console.error(`[DB Error] GET /api/widgets/${id}/config failed:`, err);
    
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ 
      error: 'Database query failed', 
      details: err.message || 'An unexpected database error occurred.' 
    });
  }
});

// ==============================================================================
// SERVER BOOTSTRAP
// Placed at the bottom of the file after all helpers and routes are defined
// ==============================================================================

// Start Express server listening on configured port
app.listen(PORT, () => {
  // Output status log to console upon successful startup
  console.log(`Server running successfully on port ${PORT}`);
});