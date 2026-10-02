// ==============================================================================
// File: src/routes/submission.js
// Description: Stage 4 Form Submission Router
// ==============================================================================

import express from 'express';
import db from '../../db.js'; // Adjust relative path if your db.js location differs
import { validateSubmission } from '../middleware/validateSubmission.js';

const router = express.Router();

/**
 * Public Form Submission Endpoint
 * Route: POST /api/embed/submit
 */
router.post('/submit', validateSubmission, async (req, res) => {
  try {
    // FIX: read the sanitized object produced by validateSubmission (Zod) instead of raw req.body
    const { widget_id, payload, data, metadata } = req.validatedData;

    // FIX: this variable was used below but never defined (ReferenceError).
    // Map submission content from either the 'payload' or the 'data' field.
    const submissionContent = payload && Object.keys(payload).length > 0 ? payload : data;

    // widget_id was already coerced to a positive integer by the validator
    const cleanWidgetId = widget_id;

    // Check if target widget exists in PostgreSQL database
    const widgetCheck = await db.query(
      'SELECT id FROM widgets WHERE id = $1;',
      [cleanWidgetId]
    );

    if (widgetCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Not Found',
        message: `Widget with ID ${cleanWidgetId} does not exist.`
      });
    }

    // Serialize objects for PostgreSQL jsonb positional parameters ($2, $3)
    const serializedPayload = JSON.stringify(submissionContent);

    const serializedMetadata = JSON.stringify(metadata || {});

    // Execute PostgreSQL Insert
    const insertQuery = `
      INSERT INTO submissions (widget_id, payload, metadata, created_at)
      VALUES ($1, $2::jsonb, $3::jsonb, NOW())
      RETURNING id, widget_id, created_at;
    `;

    const result = await db.query(insertQuery, [
      cleanWidgetId,
      serializedPayload,
      serializedMetadata
    ]);

    const newSubmission = result.rows[0];

    return res.status(201).json({
      message: 'Submission received successfully',
      submission_id: newSubmission.id,
      widget_id: newSubmission.widget_id,
      created_at: newSubmission.created_at
    });

  } catch (error) {
    // Full detail stays in the server log only
    console.error('[Stage 4 Submission Error]:', error.stack || error.message);

    // FIX: do not leak raw database error text (table names, SQL) to public callers
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'An internal error occurred while processing the submission.'
    });
  }
});

// Export default router for mounting in server.js
export default router;
