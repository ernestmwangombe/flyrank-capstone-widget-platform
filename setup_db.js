// =============================================================================
// DATABASE SETUP SCRIPT (Executes schema.sql via pg Pool & Seeds Test Data)
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

    // =========================================================================
    // SEED TEST DATA FOR INTEGRATION TESTING (Stage 3)
    // =========================================================================
    console.log('Seeding initial tenant and widget test records...');

    // SQL query to insert test tenant record into tenants table
    const seedTenantQuery = `
      INSERT INTO tenants (email, password_hash, company_name)
      VALUES ($1, $2, $3)
      RETURNING id, company_name;
    `;
    // Placeholders for parameterized tenant query
    const tenantValues = ['admin@flyrank.io', 'hashed_secure_password', 'FlyRank Test Corp'];
    const tenantResult = await pool.query(seedTenantQuery, tenantValues);
    const seededTenant = tenantResult.rows[0];

    console.log(`Successfully seeded tenant ID ${seededTenant.id}: ${seededTenant.company_name}`);

    // SQL query to insert test widget record into widgets table (Guarantees Widget ID 1)
    const seedWidgetQuery = `
      INSERT INTO widgets (tenant_id, name, type, config)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name;
    `;
    // Placeholders for parameterized widget query ($1 matches tenant_id as string/VARCHAR)
    const widgetValues = [
      String(seededTenant.id),
      'FlyRank Lead Collector',
      'signup_form',
      JSON.stringify({
        title: 'Subscribe to Newsletter',
        buttonText: 'Join Now',
        theme: 'blue'
      })
    ];

    const widgetResult = await pool.query(seedWidgetQuery, widgetValues);
    const seededWidget = widgetResult.rows[0];

    console.log(`Successfully seeded widget ID ${seededWidget.id}: "${seededWidget.name}"`);

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