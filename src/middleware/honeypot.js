// ==============================================================================
// File: src/middleware/honeypot.js
// Description: Spam control. A hidden form field that humans never fill in but bots do.
// ==============================================================================

// Name of the hidden field. The widget form must include it as a hidden input named "website" that real visitors never see
export const HONEYPOT_FIELD = 'website';

/**
 * Express middleware. If the honeypot field has any content the request is treated as spam:
 * it is NOT stored, and the bot receives a normal-looking success reply so it learns nothing.
 * Runs after validation, so req.validatedData already exists.
 */
export function honeypotGuard(req, res, next) {
  // Take the cleaned fields from the validator
  const { payload, data } = req.validatedData;
  // The form fields live in "payload" or "data" (same rule the submission route uses)
  const content = payload && Object.keys(payload).length > 0 ? payload : data;
  // Read the honeypot field (undefined when the form did not include it)
  const value = content ? content[HONEYPOT_FIELD] : undefined;
  // The field counts as filled when it exists, is not null and has some non-space text
  const filled = value !== undefined && value !== null && String(value).trim() !== '';

  // Empty honeypot: this looks like a real visitor, so continue
  if (!filled) {
    // Hand over to the next step
    return next();
  }

  // Log the dropped spam as one JSON line (widget id only, no visitor data)
  console.warn(JSON.stringify({ event: 'spam_blocked', reason: 'honeypot', widget_id: req.validatedData.widget_id }));
  // Silently drop: reply with the normal success status and message, but without a submission id because nothing was stored
  return res.status(201).json({ message: 'Submission received successfully' });
}
