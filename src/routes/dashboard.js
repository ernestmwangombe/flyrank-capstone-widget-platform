// ==============================================================================
// File: src/routes/dashboard.js
// Description: HTTP layer for the owner dashboard API (Stage 6). Every route requires a valid login token
// and only ever returns the caller's own data.
// ==============================================================================

// Import the Express framework to build a modular router
import express from 'express';
// Import the shared login check (sets req.tenantId from the verified token)
import { authenticateTenant } from '../middleware/authenticateTenant.js';
// Import the input validators
import { validateListQuery, validateOverTimeQuery, validateGeoQuery, validateIdParam } from '../middleware/validateDashboard.js';
// Import the logic layer
import { getSubmissions, getSubmission, getWidgetStats, getOverTime, getGeo } from '../services/dashboardService.js';

// Create an isolated router instance for dashboard routes
const router = express.Router();

// One line protects every route in this router: no valid token, no dashboard
router.use(authenticateTenant);

// Helper: send a service result as an HTTP response
function respond(res, result) {
  // Success: 200 with the body
  if (result.status === 'ok') return res.status(200).json(result.body);
  // A widget filter that is not the caller's: 404 (same as a missing widget)
  if (result.status === 'widget_not_found') return res.status(404).json({ error: 'Widget not found' });
  // A submission that is missing or not the caller's: 404
  return res.status(404).json({ error: 'Submission not found' });
}

// Helper: run a handler and turn any unexpected failure into a generic 500 (details only in the server log)
function guarded(label, handler) {
  // Return the real Express handler
  return async (req, res) => {
    try {
      // Run the logic and send the result
      return respond(res, await handler(req));
    } catch (err) {
      // Log the full error on the server only
      console.error(`[Dashboard ${label} Error]:`, err.message);
      // Reply with a generic message so database details never reach the client
      return res.status(500).json({ error: 'Database operation failed' });
    }
  };
}

// GET /submissions?widget_id=&from=&to=&limit=&offset=  - the owner's submissions, newest first
router.get('/submissions', validateListQuery, guarded('Submissions', (req) =>
  getSubmissions({ tenantId: req.tenantId, query: req.validated })
));

// GET /submissions/:id  - one submission (404 if it is not the caller's)
router.get('/submissions/:id', validateIdParam, guarded('Submission', (req) =>
  getSubmission({ tenantId: req.tenantId, id: req.validated.id })
));

// GET /stats/widgets  - per-widget totals and recent counts
router.get('/stats/widgets', guarded('Widget Stats', (req) =>
  getWidgetStats({ tenantId: req.tenantId })
));

// GET /stats/over-time?days=&widget_id=  - submissions per UTC day
router.get('/stats/over-time', validateOverTimeQuery, guarded('Over Time', (req) =>
  getOverTime({ tenantId: req.tenantId, query: req.validated })
));

// GET /stats/geo?days=&widget_id=  - submissions grouped by visitor country
router.get('/stats/geo', validateGeoQuery, guarded('Geo', (req) =>
  getGeo({ tenantId: req.tenantId, query: req.validated })
));

// Export the router so server.js can mount it
export default router;
