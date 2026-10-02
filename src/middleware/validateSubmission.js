// ==============================================================================
// FlyRank Capstone - Form Submission Validation Middleware
// Validates request payload structure, field types, and metadata in-memory
// ==============================================================================

import { z } from 'zod';

/**
 * Regex matching standard IPv4 and IPv6 string formats.
 * Used instead of z.string().ip() to maintain full compatibility across Zod v3 and v4.
 */
const IP_REGEX = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

/**
 * Zod schema defining the structural payload contract for submission endpoints.
 * Updated to support both 'data' and 'payload' keys flexibly while enforcing non-empty records.
 */
const submissionSchema = z.object({
  // FIX: widgets.id is a SERIAL integer in schema.sql, so only positive integers are valid.
  // z.coerce also accepts numeric strings such as "1" (HTML forms send strings).
  // The old UUID branch let values like "123e4567-..." through, which parseInt() silently turned into 123.
  widget_id: z.coerce.number({ error: "widget_id must be a positive integer" })
    .int({ error: "widget_id must be a positive integer" })
    .positive({ error: "widget_id must be a positive integer" }),

  // Flexible fields: Accept either 'data' or 'payload' as optional records
  data: z.record(z.string(), z.unknown()).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),

  // Optional tracking and metadata payload
  metadata: z
    .object({
      source_url: z.string().url("source_url must be a valid URL").optional(),
      page_url: z.string().url("page_url must be a valid URL").optional(),
      referrer: z.string().optional(),
      ip_address: z.string().regex(IP_REGEX, { message: "ip_address must be a valid IP address" }).optional()
    })
    .optional()
}).refine(
  (val) => (val.data && Object.keys(val.data).length > 0) || (val.payload && Object.keys(val.payload).length > 0), 
  {
    message: "Either 'data' or 'payload' object is required and cannot be empty",
    path: ["payload"]
  }
);

/**
 * Middleware: Pure Input Validation
 * Validates request payload structure in-memory before proceeding to downstream handlers.
 * Database existence checks are delegated to the database tier/controller.
 */
export function validateSubmission(req, res, next) {
  try {
    const parseResult = submissionSchema.safeParse(req.body);

    if (!parseResult.success) {
      const formattedErrors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'payload',
        message: issue.message
      }));

      return res.status(400).json({
        error: "Validation Failed",
        details: formattedErrors
      });
    }

    // Attach parsed and sanitized payload to request object
    req.validatedData = parseResult.data;
    return next();
  } catch (error) {
    // Pass unexpected runtime exceptions to Express global error handling middleware
    return next(error);
  }
}