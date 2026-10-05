// ==============================================================================
// File: src/repositories/dashboardRepository.js
// Description: Data layer for the owner dashboard. The only place that runs dashboard SQL.
// TENANT ISOLATION: every query joins submissions to widgets and filters on widgets.tenant_id = the caller's id,
// so a tenant can never read another tenant's submissions, whatever ids or filters they send.
// ==============================================================================

// Import the shared PostgreSQL connection pool
import db from '../../db.js';

// Helper: builds the shared WHERE clause (and its parameter list) used by the list and count queries
function buildFilters({ tenantId, widgetId, from, to }) {
  // The tenant condition is ALWAYS first and always present
  const conditions = ['w.tenant_id = $1'];
  // Parameter values in the same order as the $ placeholders
  const values = [tenantId];
  // Optional widget filter
  if (widgetId) {
    // Add the value and refer to it by its position
    values.push(widgetId);
    // Only submissions of this widget
    conditions.push(`s.widget_id = $${values.length}`);
  }
  // Optional start of the time window (inclusive)
  if (from) {
    // Add the value
    values.push(from);
    // Created at or after "from"
    conditions.push(`s.created_at >= $${values.length}`);
  }
  // Optional end of the time window (exclusive)
  if (to) {
    // Add the value
    values.push(to);
    // Created before "to"
    conditions.push(`s.created_at < $${values.length}`);
  }
  // Join the conditions with AND and return them with the values
  return { where: conditions.join(' AND '), values };
}

// Returns true when the widget exists AND belongs to this tenant
export async function widgetBelongsToTenant(widgetId, tenantId) {
  // Parameterized query: ids and tenant are values, never text pasted into the SQL
  const result = await db.query('SELECT 1 FROM widgets WHERE id = $1 AND tenant_id = $2;', [widgetId, tenantId]);
  // A row means the widget is theirs
  return result.rows.length > 0;
}

// Returns one page of the tenant's submissions, newest first
export async function listSubmissions({ tenantId, widgetId, from, to, limit, offset }) {
  // Build the WHERE clause and values
  const { where, values } = buildFilters({ tenantId, widgetId, from, to });
  // Add the paging values after the filter values
  values.push(limit, offset);
  // Run the query; LIMIT and OFFSET use the last two placeholders
  const result = await db.query(
    `SELECT s.id, s.widget_id, w.name AS widget_name, s.payload, s.metadata, s.geo, s.created_at
       FROM submissions s
       JOIN widgets w ON w.id = s.widget_id
      WHERE ${where}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length};`,
    values
  );
  // Return the rows
  return result.rows;
}

// Returns how many submissions match the same filters (used for the pagination total)
export async function countSubmissions({ tenantId, widgetId, from, to }) {
  // Build the WHERE clause and values
  const { where, values } = buildFilters({ tenantId, widgetId, from, to });
  // Count the matching rows
  const result = await db.query(
    `SELECT count(*)::int AS total
       FROM submissions s
       JOIN widgets w ON w.id = s.widget_id
      WHERE ${where};`,
    values
  );
  // Return the number
  return result.rows[0].total;
}

// Returns one submission by id, but only if it belongs to the tenant (otherwise undefined)
export async function findSubmissionById(id, tenantId) {
  // Both the id and the tenant must match
  const result = await db.query(
    `SELECT s.id, s.widget_id, w.name AS widget_name, s.payload, s.metadata, s.geo, s.created_at
       FROM submissions s
       JOIN widgets w ON w.id = s.widget_id
      WHERE s.id = $1 AND w.tenant_id = $2;`,
    [id, tenantId]
  );
  // First row or undefined
  return result.rows[0];
}

// Returns per-widget statistics for ALL of the tenant's widgets (widgets with no submissions show zeros)
export async function statsPerWidget(tenantId) {
  // LEFT JOIN keeps widgets that have no submissions; FILTER counts only the rows that match a condition
  const result = await db.query(
    `SELECT w.id AS widget_id,
            w.name,
            w.type,
            count(s.id)::int AS total_submissions,
            count(s.id) FILTER (WHERE s.created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h,
            count(s.id) FILTER (WHERE s.created_at >= NOW() - INTERVAL '7 days')::int AS last_7d,
            count(s.geo)::int AS enriched_submissions,
            max(s.created_at) AS last_submission_at
       FROM widgets w
       LEFT JOIN submissions s ON s.widget_id = w.id
      WHERE w.tenant_id = $1
      GROUP BY w.id
      ORDER BY total_submissions DESC, w.id ASC;`,
    [tenantId]
  );
  // Return the rows
  return result.rows;
}

// Returns submissions per UTC day for the last N days, with zero-count days included so the series has no gaps
export async function countsOverTime({ tenantId, widgetId, days }) {
  // $1 = days, $2 = tenant, $3 = optional widget
  const values = [days, tenantId];
  // Optional widget condition
  let widgetCondition = '';
  // Add it only when a widget filter was requested
  if (widgetId) {
    // Add the value
    values.push(widgetId);
    // Only this widget's submissions
    widgetCondition = `AND s.widget_id = $${values.length}`;
  }
  // generate_series makes one row per day; the LEFT JOIN attaches the real counts to those days
  const result = await db.query(
    `WITH bounds AS (SELECT (NOW() AT TIME ZONE 'UTC')::date AS today)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COALESCE(c.n, 0)::int AS count
       FROM bounds b
      CROSS JOIN LATERAL generate_series((b.today - ($1::int - 1))::timestamp, b.today::timestamp, INTERVAL '1 day') AS d(day)
       LEFT JOIN (
              SELECT (s.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n
                FROM submissions s
                JOIN widgets w ON w.id = s.widget_id
               WHERE w.tenant_id = $2 ${widgetCondition}
                 AND s.created_at >= (((SELECT today FROM bounds) - ($1::int - 1))::timestamp AT TIME ZONE 'UTC')
               GROUP BY 1
            ) c ON c.day = d.day::date
      ORDER BY d.day;`,
    values
  );
  // Return the rows
  return result.rows;
}

// Returns submission counts grouped by visitor country ("Unknown" = no provider could locate the visitor)
export async function geoBreakdown({ tenantId, widgetId, days }) {
  // $1 = tenant
  const values = [tenantId];
  // Extra conditions added below
  const conditions = ['w.tenant_id = $1'];
  // Optional widget filter
  if (widgetId) {
    // Add the value
    values.push(widgetId);
    // Only this widget
    conditions.push(`s.widget_id = $${values.length}`);
  }
  // Optional "last N days" filter
  if (days) {
    // Add the value
    values.push(days);
    // Only submissions from the last N days
    conditions.push(`s.created_at >= NOW() - make_interval(days => $${values.length}::int)`);
  }
  // Group by country; submissions with no geo data fall into the "Unknown" group
  const result = await db.query(
    `SELECT COALESCE(s.geo->>'country', 'Unknown') AS country,
            s.geo->>'country_code' AS country_code,
            count(*)::int AS count
       FROM submissions s
       JOIN widgets w ON w.id = s.widget_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY 1, 2
      ORDER BY count DESC, country ASC;`,
    values
  );
  // Return the rows
  return result.rows;
}
