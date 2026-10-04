// ==============================================================================
// File: src/repositories/submissionRepository.js
// Description: Data layer. The only place that runs SQL for submissions.
// ==============================================================================

// Import the shared PostgreSQL connection pool
import db from '../../db.js';

// Returns true when a widget with this id exists
export async function widgetExists(widgetId) {
  // Parameterized query ($1) so the id can never be used for SQL injection
  const result = await db.query('SELECT id FROM widgets WHERE id = $1;', [widgetId]);
  // At least one row means the widget exists
  return result.rows.length > 0;
}

// Inserts one submission and returns its id, widget id and creation time
export async function insertSubmission({ widgetId, payload, metadata, geo }) {
  // The geo column is NULL when no provider could answer (geo is null), otherwise a JSON document
  const result = await db.query(
    `INSERT INTO submissions (widget_id, payload, metadata, geo, created_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, NOW())
     RETURNING id, widget_id, created_at;`,
    [widgetId, JSON.stringify(payload), JSON.stringify(metadata || {}), geo ? JSON.stringify(geo) : null]
  );
  // Return the new row
  return result.rows[0];
}
