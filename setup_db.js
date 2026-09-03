// =============================================================================
// DATABASE SETUP SCRIPT (Executes schema.sql via pg Pool)
// =============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Create PostgreSQL pool connection
const pool = new Pool({
connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/lead_capture',
ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function applySchema() {
try {
console.log('Connecting to database and reading schema.sql...');
const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

    console.log('Executing schema statements...');
    await pool.query(schemaSql);

    console.log('Successfully initialized database tables and indexes!');
} catch (err) {
    console.error('Failed to apply schema:', err.message);
    process.exit(1);
} finally {
    await pool.end();
}


}

applySchema();