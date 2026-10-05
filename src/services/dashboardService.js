// ==============================================================================
// File: src/services/dashboardService.js
// Description: Logic layer for the owner dashboard. Checks widget ownership, calls the data layer and shapes the answers.
// ==============================================================================

// Import every data-layer function the dashboard needs
import {
  widgetBelongsToTenant,
  listSubmissions as repoListSubmissions,
  countSubmissions,
  findSubmissionById,
  statsPerWidget,
  countsOverTime,
  geoBreakdown
} from '../repositories/dashboardRepository.js';

// Helper: when a widget filter is given, confirm the widget belongs to the caller (a foreign widget looks exactly like a missing one)
async function widgetFilterIsAllowed(widgetId, tenantId) {
  // No filter requested: nothing to check
  if (!widgetId) return true;
  // Otherwise the widget must be theirs
  return widgetBelongsToTenant(widgetId, tenantId);
}

// Helper: turn a database row into the object the API returns
function shapeSubmission(row) {
  // Pick the fields owners should see
  return {
    id: row.id,
    widget_id: row.widget_id,
    widget_name: row.widget_name,
    payload: row.payload,
    metadata: row.metadata,
    geo: row.geo,
    created_at: row.created_at
  };
}

// One page of the owner's submissions plus the pagination totals
export async function getSubmissions({ tenantId, query }) {
  // Take the validated filters
  const { widget_id, from, to, limit, offset } = query;
  // A widget filter must point at one of the caller's widgets
  if (!(await widgetFilterIsAllowed(widget_id, tenantId))) {
    // Tell the route to answer 404
    return { status: 'widget_not_found' };
  }
  // Run the page query and the count query at the same time
  const [rows, total] = await Promise.all([
    repoListSubmissions({ tenantId, widgetId: widget_id, from, to, limit, offset }),
    countSubmissions({ tenantId, widgetId: widget_id, from, to })
  ]);
  // Return the shaped page
  return { status: 'ok', body: { data: rows.map(shapeSubmission), pagination: { total, limit, offset } } };
}

// One submission by id (404 when it does not exist or belongs to another tenant)
export async function getSubmission({ tenantId, id }) {
  // The data layer only returns it if the tenant matches
  const row = await findSubmissionById(id, tenantId);
  // Missing or foreign: the same answer in both cases, so existence is never leaked
  if (!row) return { status: 'submission_not_found' };
  // Return the shaped submission
  return { status: 'ok', body: shapeSubmission(row) };
}

// Per-widget statistics for all of the owner's widgets
export async function getWidgetStats({ tenantId }) {
  // Read the rows
  const rows = await statsPerWidget(tenantId);
  // Return them as { data: [...] }
  return { status: 'ok', body: { data: rows } };
}

// Submissions per UTC day for the last N days
export async function getOverTime({ tenantId, query }) {
  // Take the validated options
  const { widget_id, days } = query;
  // A widget filter must point at one of the caller's widgets
  if (!(await widgetFilterIsAllowed(widget_id, tenantId))) {
    // Tell the route to answer 404
    return { status: 'widget_not_found' };
  }
  // Read one row per day
  const rows = await countsOverTime({ tenantId, widgetId: widget_id, days });
  // Add the counts up for the response header
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  // Return the series with the first and last date
  return {
    status: 'ok',
    body: {
      days,
      from: rows.length ? rows[0].date : null,
      to: rows.length ? rows[rows.length - 1].date : null,
      widget_id: widget_id || null,
      total,
      data: rows
    }
  };
}

// Submissions grouped by visitor country, with each country's share of the total
export async function getGeo({ tenantId, query }) {
  // Take the validated options
  const { widget_id, days } = query;
  // A widget filter must point at one of the caller's widgets
  if (!(await widgetFilterIsAllowed(widget_id, tenantId))) {
    // Tell the route to answer 404
    return { status: 'widget_not_found' };
  }
  // Read one row per country
  const rows = await geoBreakdown({ tenantId, widgetId: widget_id, days });
  // Total submissions covered by the breakdown
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  // Add each country's percentage (one decimal place; 0 when there is nothing to divide)
  const data = rows.map((row) => ({
    ...row,
    percent: total > 0 ? Math.round((row.count / total) * 1000) / 10 : 0
  }));
  // Return the breakdown
  return { status: 'ok', body: { total, widget_id: widget_id || null, days: days || null, data } };
}
