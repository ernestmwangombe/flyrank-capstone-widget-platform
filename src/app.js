import express from 'express';
import submissionRoutes from './routes/submission.js';

const app = express();

// Global parsing middleware
app.use(express.json());

// Mount public submission routes
app.use(submissionRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]:', err.stack || err);
  res.status(500).json({
    error: "Internal Server Error",
    message: "An unexpected error occurred on the server."
  });
});

export default app;