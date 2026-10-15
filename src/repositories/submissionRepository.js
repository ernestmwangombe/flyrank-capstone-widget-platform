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

// Inserts one submission and returns its id, widget id and creation time.
// With an idempotency key the insert is "first one wins": the database itself refuses a second row for the same (widget, key)
// pair, so even two simultaneous requests with the same key can only create ONE row. When the row already exists, nothing is
// inserted and undefined is returned (the caller then looks the existing row up).
export async function insertSubmission({ widgetId, payload, metadata, geo, idempotencyKey }) {
  // The geo column is NULL when no provider could answer (geo is null), otherwise a JSON document.
  // ON CONFLICT ... DO NOTHING matches the partial unique index on (widget_id, idempotency_key); rows without a key never conflict.
  const result = await db.query(
    `INSERT INTO submissions (widget_id, payload, metadata, geo, idempotency_key, created_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, NOW())
     ON CONFLICT (widget_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING id, widget_id, created_at;`,
    [widgetId, JSON.stringify(payload), JSON.stringify(metadata || {}), geo ? JSON.stringify(geo) : null, idempotencyKey || null]
  );
  // The new row, or undefined when the (widget, key) pair already existed
  return result.rows[0];
}

// Finds an earlier submission made with the same idempotency key on the same widget.
// same_payload tells whether the new request carries the SAME form answers (jsonb equality ignores key order).
export async function findByIdempotencyKey(widgetId, idempotencyKey, payload) {
  // Both the widget and the key must match; the key is only unique within one widget
  const result = await db.query(
    `SELECT id, widget_id, created_at, geo, (payload = $3::jsonb) AS same_payload
       FROM submissions
      WHERE widget_id = $1 AND idempotency_key = $2;`,
    [widgetId, idempotencyKey, JSON.stringify(payload)]
  );
  // The existing row, or undefined when the key has not been used before
  return result.rows[0];
}
