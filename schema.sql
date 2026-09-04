-- File: schema.sql
-- Description: Database schema initialization script for multi-tenant widget platform

-- Drop existing tables to ensure a clean, reproducible database state during setup
DROP TABLE IF EXISTS widgets CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- Create tenants table to store client organization credentials
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,                                       -- Unique identifier for each tenant
  email VARCHAR(255) UNIQUE NOT NULL,                          -- Unique tenant account email
  password_hash VARCHAR(255) NOT NULL,                         -- Salted password hash
  company_name VARCHAR(255) NOT NULL,                          -- Registered company name
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP -- Record creation timestamp
);

-- Create widgets table storing configuration and snippet attributes
CREATE TABLE widgets (
  id SERIAL PRIMARY KEY,                                       -- Unique identifier for each widget
  tenant_id VARCHAR(255) NOT NULL,                             -- Associated tenant owner identifier
  name VARCHAR(255) NOT NULL,                                  -- Friendly widget display name
  type VARCHAR(100) NOT NULL,                                  -- Functional type identifier (e.g., 'signup_form', 'cta')
  config JSONB DEFAULT '{}'::jsonb,                            -- JSON blob storing dynamic configuration properties
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP -- Record creation timestamp
);

-- Index tenant_id on widgets table to optimize query performance for multi-tenant isolation
CREATE INDEX idx_widgets_tenant_id ON widgets(tenant_id);