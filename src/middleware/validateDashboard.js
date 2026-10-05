// ==============================================================================
// File: src/middleware/validateDashboard.js
// Description: Validation at the boundary for the dashboard endpoints (query strings and URL ids).
// Bad input becomes a clean 400 JSON error, never a 500.
// ==============================================================================

// Import Zod, the validation library already used for submissions
import { z } from 'zod';

// Helper: a required-or-optional positive whole number that may arrive as text (query strings are always text)
const positiveInt = (label) =>
  // z.coerce.number turns "12" into 12; the checks below reject 0, negatives, decimals and non-numbers
  z.coerce.number({ error: `${label} must be a positive whole number` })
    .int({ error: `${label} must be a positive whole number` })
    .positive({ error: `${label} must be a positive whole number` });

// Helper: an ISO date or date-time such as 2026-10-04 or 2026-10-04T10:00:00Z.
// "bareDateEndsAfterDay" is true for the "to" parameter: a bare date then means "up to the END of that day".
const isoDate = (label, bareDateEndsAfterDay) =>
  // First require the text to look like an ISO date (this blocks values such as "1" that JavaScript would accept as a year)
  z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, {
    error: `${label} must be an ISO date such as 2026-10-04 or 2026-10-04T10:00:00Z`
  })
    // Then require it to be a real calendar date (blocks 2026-13-45)
    .refine((value) => !Number.isNaN(Date.parse(value)), { error: `${label} is not a real date` })
    // Finally convert the text to a Date object
    .transform((value) => {
      // Parse the text (a bare date is read as midnight UTC)
      const date = new Date(value);
      // For "to" with a bare date, move to the start of the NEXT day so the whole named day is included (to is exclusive)
      if (bareDateEndsAfterDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        // Add one day in UTC
        date.setUTCDate(date.getUTCDate() + 1);
      }
      // Hand back the Date
      return date;
    });

// Query contract for GET /submissions
const listQuerySchema = z.object({
  // Optional: only this widget (it must belong to the caller, checked later)
  widget_id: positiveInt('widget_id').optional(),
  // Optional: submissions created at or after this moment
  from: isoDate('from', false).optional(),
  // Optional: submissions created before this moment (a bare date includes that whole day)
  to: isoDate('to', true).optional(),
  // Page size: 1 to 100, default 20
  limit: z.coerce.number({ error: 'limit must be a whole number from 1 to 100' })
    .int({ error: 'limit must be a whole number from 1 to 100' })
    .min(1, { error: 'limit must be a whole number from 1 to 100' })
    .max(100, { error: 'limit must be a whole number from 1 to 100' })
    .default(20),
  // How many rows to skip, default 0
  offset: z.coerce.number({ error: 'offset must be a whole number of 0 or more' })
    .int({ error: 'offset must be a whole number of 0 or more' })
    .min(0, { error: 'offset must be a whole number of 0 or more' })
    .default(0)
}).refine((value) => !(value.from && value.to) || value.from < value.to, {
  // A time window that ends before it starts is a client mistake
  error: 'from must be earlier than to',
  path: ['from']
});

// Query contract for GET /stats/over-time
const overTimeQuerySchema = z.object({
  // Optional: only this widget
  widget_id: positiveInt('widget_id').optional(),
  // How many days to cover, ending today (UTC): 1 to 365, default 30
  days: z.coerce.number({ error: 'days must be a whole number from 1 to 365' })
    .int({ error: 'days must be a whole number from 1 to 365' })
    .min(1, { error: 'days must be a whole number from 1 to 365' })
    .max(365, { error: 'days must be a whole number from 1 to 365' })
    .default(30)
});

// Query contract for GET /stats/geo
const geoQuerySchema = z.object({
  // Optional: only this widget
  widget_id: positiveInt('widget_id').optional(),
  // Optional: only the last N days (omit it for all time)
  days: z.coerce.number({ error: 'days must be a whole number from 1 to 365' })
    .int({ error: 'days must be a whole number from 1 to 365' })
    .min(1, { error: 'days must be a whole number from 1 to 365' })
    .max(365, { error: 'days must be a whole number from 1 to 365' })
    .optional()
});

// Contract for the :id URL segment
const idParamSchema = z.object({
  // The submission id must be a positive whole number
  id: positiveInt('id')
});

// Builds a middleware that validates one part of the request ("query" or "params") against a schema
function validate(source, schema) {
  // Return the actual Express middleware
  return (req, res, next) => {
    // Check the request data against the contract without throwing
    const result = schema.safeParse(req[source]);
    // Valid: keep the cleaned values for the handler and continue
    if (result.success) {
      // Store the cleaned values (numbers as numbers, dates as Date objects, defaults filled in)
      req.validated = { ...(req.validated || {}), ...result.data };
      // Hand over to the next step
      return next();
    }
    // Invalid: list every problem as { field, message } so the client knows exactly what to fix
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || source,
      message: issue.message
    }));
    // Reply 400 Bad Request with the standard validation error body
    return res.status(400).json({ error: 'Validation Failed', details });
  };
}

// Ready-made middlewares for the router
export const validateListQuery = validate('query', listQuerySchema);
export const validateOverTimeQuery = validate('query', overTimeQuerySchema);
export const validateGeoQuery = validate('query', geoQuerySchema);
export const validateIdParam = validate('params', idParamSchema);
