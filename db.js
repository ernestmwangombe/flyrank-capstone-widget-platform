// ==============================================================================
// db.js - PostgreSQL Database Connection Module
// ==============================================================================

// Import dotenv to load environment variables from .env file into process.env
require('dotenv').config();

// Import the Pool class from the 'pg' (node-postgres) driver package
const { Pool } = require('pg');

// Construct configuration object dynamically from environment variables
const poolConfig = process.env.DATABASE_URL
  ? {
      // Use single connection string if defined (e.g. Heroku, Render, AWS RDS)
      connectionString: process.env.DATABASE_URL,
      // Enable SSL in production environments with relaxed self-signed check
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    }
  : {
      // Fallback to individual connection parameters from .env file
      host: process.env.DB_HOST || 'localhost',         // Host address
      port: parseInt(process.env.DB_PORT || '5432', 10), // Port number integer
      user: process.env.DB_USER || 'postgres',          // Database username
      password: process.env.DB_PASSWORD || 'postgres',  // Database password
      database: process.env.DB_NAME || 'widget_platform', // Target database name
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    };

// Initialize a new PostgreSQL connection pool instance
const pool = new Pool(poolConfig);

// Log event when the pool establishes a new client connection
pool.on('connect', () => {
  // Console confirmation for debugging runtime database connections
  console.log('PostgreSQL client connected to server process.');
});

// Log fatal error events emitted by idle pool clients to prevent crashes
pool.on('error', (err) => {
  // Print connection error details to error stream
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

// Export the pool instance so server.js can execute queries via pool.query()
module.exports = pool;