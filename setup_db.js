// =============================================================================
// DATABASE SETUP SCRIPT (Executes schema.sql via pg Pool)
// =============================================================================

// File: setup_db.js
// Description: Node.js runner to execute schema.sql against local or containerized PostgreSQL

// Import the filesystem module to read the schema file
const fs = require('fs');
// Import path module to resolve relative file locations safely
const path = require('path');
// Import the database pool instance configured with environment variables
const pool = require('./db');

// Define asynchronous function to initialize database tables
async function initializeDatabase() {
  try {
    // Resolve absolute path to schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    
    // Read raw SQL script string from disk
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Applying database schema from schema.sql...');
    
    // Execute raw SQL batch against PostgreSQL connection pool
    await pool.query(sql);

    console.log('Database successfully initialized with latest schema!');
  } catch (error) {
    // Log detailed execution error if table creation or query fails
    console.error('Failed to initialize database schema:', error);
    process.exit(1);
  } finally {
    // Gracefully shut down pool client connection
    await pool.end();
  }
}

// Execute initialization runner
initializeDatabase();