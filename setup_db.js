// setup_db.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js'; // Ensure file extension is explicit in ESM imports

// Reconstruct __dirname equivalent for ES Module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initializeDatabase() {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Applying database schema from schema.sql...');
    await pool.query(sql);
    console.log('Database successfully initialized with latest schema!');

    console.log('Seeding initial tenant and widget test records...');

    const seedTenantQuery = `
      INSERT INTO tenants (email, password_hash, company_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE SET company_name = EXCLUDED.company_name
      RETURNING id, company_name;
    `;
    const tenantValues = ['admin@flyrank.io', 'hashed_secure_password', 'FlyRank Test Corp'];
    const tenantResult = await pool.query(seedTenantQuery, tenantValues);
    const seededTenant = tenantResult.rows[0];

    console.log(`Successfully seeded tenant ID ${seededTenant.id}: ${seededTenant.company_name}`);

    const seedWidgetQuery = `
      INSERT INTO widgets (tenant_id, name, type, config)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO NOTHING
      RETURNING id, name;
    `;
    const widgetValues = [
      seededTenant.id,
      'FlyRank Lead Collector',
      'signup_form',
      JSON.stringify({
        title: 'Subscribe to Newsletter',
        buttonText: 'Join Now',
        theme: 'blue'
      })
    ];

    const widgetResult = await pool.query(seedWidgetQuery, widgetValues);
    if (widgetResult.rows.length > 0) {
      console.log(`Successfully seeded widget ID ${widgetResult.rows[0].id}: "${widgetResult.rows[0].name}"`);
    } else {
      console.log('Widget record already exists, skipping duplicate insert.');
    }

  } catch (error) {
    console.error('Failed to initialize database schema:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initializeDatabase();