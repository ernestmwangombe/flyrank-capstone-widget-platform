import rateLimit from 'express-rate-limit';

// Prevent abuse on public endpoints (Firewall rule equivalent for application tier)
export const submissionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 submissions per 15-minute window
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  message: {
    error: "Too Many Requests",
    message: "Submission limit exceeded. Please try again later."
  }
});