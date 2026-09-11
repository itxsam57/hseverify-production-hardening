DROP TABLE IF EXISTS deployment_releases;
DROP TABLE IF EXISTS worker_profiles;
DELETE FROM hse_schema_migrations WHERE migration_id = '0001_platform_foundation';
