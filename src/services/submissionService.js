// ==============================================================================
// File: src/services/submissionService.js
// Description: Business logic layer for a public submission:
// check widget -> enrich with geo (never fails) -> store -> queue confirmation (never fails the request)
// ==============================================================================

// Import the data-layer functions
import { widgetExists, insertSubmission } from '../repositories/submissionRepository.js';
// Import the geo lookup with its fallback chain
import { enrichIp } from './geoService.js';
// Import the background confirmation queue and the email shape check
import { enqueueConfirmation, looksLikeEmail } from './notifier.js';

/**
 * Creates a submission.
 * Returns { status: 'widget_not_found' } or { status: 'created', submission, enrichment }.
 * Throws only for real storage failures (the route turns those into a generic 500).
 */
export async function createSubmission({ widgetId, content, metadata, clientIp, controls }) {
  // Step 1: the target widget must exist
  if (!(await widgetExists(widgetId))) {
    // Tell the route so it can answer 404
    return { status: 'widget_not_found' };
  }

  // Step 2: enrichment. This function never throws; if every provider fails it returns geo: null and the flow continues
  const enrichment = await enrichIp(clientIp, controls);

  // Step 3: store the submission (this is the critical step: if it fails, the error goes up to the route)
  const submission = await insertSubmission({
    widgetId,
    payload: content,
    metadata,
    geo: enrichment.geo
  });

  // Step 4: queue the confirmation email. It runs in the background and is wrapped so that nothing here can break the success path
  try {
    // Only send when the form contained a valid email address
    if (looksLikeEmail(content.email)) {
      // Queue the job and move on immediately
      enqueueConfirmation({ submissionId: submission.id, to: content.email }, controls);
    }
  } catch (err) {
    // Even queueing problems are only logged; the submission is already safely stored
    console.error(JSON.stringify({ event: 'notification_enqueue_failed', submission_id: submission.id, error: err.message }));
  }

  // Step 5: report what happened to the route
  return { status: 'created', submission, enrichment };
}
