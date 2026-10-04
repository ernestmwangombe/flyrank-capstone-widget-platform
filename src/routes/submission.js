// ==============================================================================
// File: src/routes/submission.js
// Description: HTTP layer for the public submission endpoint (Stages 4 and 5).
// Request pipeline: [IP rate limit in server.js] -> JSON body parser -> validation -> honeypot -> widget rate limit -> handler
// ==============================================================================

// Import the Express framework to build a modular router
import express from 'express';
// Import the validation middleware (Zod) from Stage 4
import { validateSubmission } from '../middleware/validateSubmission.js';
// Import the spam control (honeypot field)
import { honeypotGuard } from '../middleware/honeypot.js';
// Import the per-widget rate limiter
import { widgetRateLimiter } from '../middleware/rateLimiter.js';
// Import the business-logic layer
import { createSubmission } from '../services/submissionService.js';
// Import the helper that works out the visitor's IP address
import { getClientIp } from '../utils/clientIp.js';
// Import the helper that reads the development-only test switches
import { readTestControls } from '../utils/testControls.js';

// Create an isolated router instance for submission routes
const router = express.Router();

/**
 * Public Form Submission Endpoint
 * Route: POST /api/embed/submit
 */
router.post('/submit', validateSubmission, honeypotGuard, widgetRateLimiter, async (req, res) => {
  try {
    // Take the cleaned fields produced by the validator
    const { widget_id, payload, data, metadata } = req.validatedData;
    // The form fields live in "payload" or "data"
    const content = payload && Object.keys(payload).length > 0 ? payload : data;

    // Hand the work to the service layer. The IP used for enrichment is the one the SERVER observed, never the client-claimed metadata.ip_address
    const result = await createSubmission({
      widgetId: widget_id,
      content,
      metadata,
      clientIp: getClientIp(req),
      controls: readTestControls(req)
    });

    // Unknown widget: 404
    if (result.status === 'widget_not_found') {
      // Respond with a JSON 404 (same shape as before)
      return res.status(404).json({
        error: 'Not Found',
        message: `Widget with ID ${widget_id} does not exist.`
      });
    }

    // Success: 201 with the stored submission and a short note on how enrichment went
    return res.status(201).json({
      message: 'Submission received successfully',
      submission_id: result.submission.id,
      widget_id: result.submission.widget_id,
      created_at: result.submission.created_at,
      enrichment: {
        // "enriched", "unavailable" or "skipped"
        status: result.enrichment.status,
        // Which provider answered (null when none did)
        provider: result.enrichment.geo ? result.enrichment.geo.provider : null
      }
    });
  } catch (error) {
    // Full detail stays in the server log only
    console.error('[Submission Error]:', error.stack || error.message);
    // Generic message so database details never reach the public
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'An internal error occurred while processing the submission.'
    });
  }
});

// Export default router for mounting in server.js
export default router;
