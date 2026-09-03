require('dotenv').config();
const { Pool } = require('pg');

// We use the EXACT SAME connection settings as server.js to guarantee parity
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || ''),
  database: process.env.DB_NAME || 'widget_platform',
});

async function repairDatabase() {
  try {
    console.log(`[1] Connecting to database: ${process.env.DB_NAME}...`);
    
    // Explicitly create the tenants table with the exact columns server.js expects
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('[2] ✅ SUCCESS: The "tenants" table has been explicitly created!');

    // Explicitly create the widgets table with foreign key reference to tenants
    await pool.query(`
      CREATE TABLE IF NOT EXISTS widgets (
        id SERIAL PRIMARY KEY,
        tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('[3] ✅ SUCCESS: The "widgets" table has been explicitly created!');

  } catch (err) {
    console.error('[!] ❌ ERROR:', err.message);
  } finally {
    await pool.end();
  }
}

repairDatabase();