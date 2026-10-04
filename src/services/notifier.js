// ==============================================================================
// File: src/services/notifier.js
// Description: Safe side effect. A confirmation "email" sent AFTER the submission is stored, off the request path,
// with retries and a failure alert. If it fails, the submission is already safe and the visitor still got success.
// ==============================================================================

// Helper: read a whole number (at least 1) from an environment variable, or use the fallback
function intFromEnv(name, fallback) {
  // Convert the environment text to a number
  const value = parseInt(process.env[name], 10);
  // Use it only when it is a whole number of at least 1, otherwise the fallback
  return Number.isFinite(value) && value >= 1 ? value : fallback;
}

// Helper: wait for a number of milliseconds (used between retries)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: hide most of an email address before it goes into a log, for example "v***@example.com"
function maskEmail(email) {
  // Split into the part before and after the @ sign
  const [local, domain] = email.split('@');
  // Keep the first character and the domain only
  return `${local.slice(0, 1)}***@${domain}`;
}

// Helper: true when a value looks like an email address
export function looksLikeEmail(value) {
  // Must be text, short enough, and shaped like something@something.something
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// The "email provider". In this project it only writes a log line (the brief allows fake email); a real one would call an SMTP/API service here
async function sendConfirmationEmail(job, controls) {
  // When the test asked for the email to fail, behave like a provider outage
  if (controls && controls.notifyFail) {
    // Throw so the retry logic runs
    throw new Error('Simulated email provider outage');
  }
  // "Send" the email by logging one JSON line (the address is masked)
  console.log(JSON.stringify({
    event: 'email_sent',
    to: maskEmail(job.to),
    subject: 'We received your submission',
    submission_id: job.submissionId
  }));
}

// Runs one notification job with retries (exponential back-off) and raises an alert if every attempt fails
async function runJob(job, controls) {
  // How many attempts in total (default 3)
  const maxAttempts = intFromEnv('NOTIFY_MAX_ATTEMPTS', 3);
  // Delay before the second attempt in milliseconds (default 500); it doubles after each failure
  const baseDelayMs = intFromEnv('NOTIFY_RETRY_DELAY_MS', 500);

  // Try up to maxAttempts times
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Try to send the email
      await sendConfirmationEmail(job, controls);
      // Success: stop the job
      return;
    } catch (err) {
      // Log the failed attempt as one JSON line
      console.warn(JSON.stringify({ event: 'notification_attempt_failed', submission_id: job.submissionId, attempt, error: err.message }));
      // If attempts remain, wait before the next one (500ms, 1000ms, 2000ms, ...)
      if (attempt < maxAttempts) {
        // Pause before retrying
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  // Every attempt failed: raise the failure alert (an ERROR line that monitoring could page on)
  console.error(JSON.stringify({
    event: 'ALERT',
    message: 'Confirmation notification permanently failed after retries',
    submission_id: job.submissionId,
    attempts: maxAttempts
  }));
}

/**
 * Queues a confirmation job and returns immediately. The job runs in the background, so a slow or broken
 * email provider can never delay or break the HTTP response. (Jobs live in memory, so they are lost if the server restarts.)
 */
export function enqueueConfirmation(job, controls) {
  // setImmediate runs the job after the current request handling has finished
  setImmediate(() => {
    // Any unexpected error inside the job is logged and swallowed so it can never crash the server
    runJob(job, controls).catch((err) => {
      // Log the unexpected error
      console.error(JSON.stringify({ event: 'notification_job_crashed', submission_id: job.submissionId, error: err.message }));
    });
  });
}
