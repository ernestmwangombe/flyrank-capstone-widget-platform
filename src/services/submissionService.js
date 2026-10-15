// ==============================================================================
// File: src/services/submissionService.js
// Description: Business logic layer for a public submission:
// check widget -> enrich with geo (never fails) -> store -> queue confirmation (never fails the request)
// ==============================================================================

// Import the data-layer functions
import { widgetExists, insertSubmission, findByIdempotencyKey } from '../repositories/submissionRepository.js';
// Import the geo lookup with its fallback chain
import { enrichIp } from './geoService.js';
// Import the background confirmation queue and the email shape check
import { enqueueConfirmation, looksLikeEmail } from './notifier.js';

// Helper: turn an existing row (found by its idempotency key) into the service's answer
function replayResult(existing) {
  // Same key but different form answers: the client is reusing a key for a different submission, which is a mistake, not a retry
  if (!existing.same_payload) {
    // Tell the route so it can answer 409
    return { status: 'idempotency_conflict' };
  }
  // A true retry: hand back the ORIGINAL submission; nothing is stored, enriched or emailed again
  return {
    status: 'replayed',
    submission: { id: existing.id, widget_id: existing.widget_id, created_at: existing.created_at },
    enrichment: { status: existing.geo ? 'enriched' : 'unavailable', geo: existing.geo }
  };
}

/**
 * Creates a submission.
 * Returns { status: 'widget_not_found' }, { status: 'created', submission, enrichment },
 * { status: 'replayed', submission, enrichment } (same idempotency key and content as an earlier request)
 * or { status: 'idempotency_conflict' } (same key, different content).
 * Throws only for real storage failures (the route turns those into a generic 500).
 */
export async function createSubmission({ widgetId, content, metadata, clientIp, controls, idempotencyKey }) {
  // Step 1: the target widget must exist
  if (!(await widgetExists(widgetId))) {
    // Tell the route so it can answer 404
    return { status: 'widget_not_found' };
  }

  // Step 2: retry protection. If this key was already used on this widget, answer from the stored row and stop here,
  // BEFORE the slow geo lookup, so a retry costs almost nothing and cannot trigger a second confirmation email.
  if (idempotencyKey) {
    // Look the key up
    const existing = await findByIdempotencyKey(widgetId, idempotencyKey, content);
    // Seen before: replay (or conflict)
    if (existing) {
      // Build the answer from the stored row
      return replayResult(existing);
    }
  }

  // Step 3: enrichment. This function never throws; if every provider fails it returns geo: null and the flow continues
  const enrichment = await enrichIp(clientIp, controls);

  // Step 4: store the submission (this is the critical step: if it fails, the error goes up to the route)
  const submission = await insertSubmission({
    widgetId,
    payload: content,
    metadata,
    geo: enrichment.geo,
    idempotencyKey
  });

  // Step 4b: no row came back, so ANOTHER request with the same key won the race between our check and our insert
  if (!submission) {
    // Look up the winner's row and answer from it
    const existing = await findByIdempotencyKey(widgetId, idempotencyKey, content);
    // The winner exists by definition; answer from it
    if (existing) {
      // Build the answer from the stored row
      return replayResult(existing);
    }
    // Practically unreachable (the row cannot vanish); fail loudly so it becomes a logged 500 instead of a silent loss
    throw new Error('idempotency key conflict could not be resolved');
  }

  // Step 5: queue the confirmation email. ONLY the request that really inserted the row gets here, so the email is sent once.
  // It runs in the background and is wrapped so that nothing here can break the success path
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

  // Step 6: report what happened to the route
  return { status: 'created', submission, enrichment };
}
