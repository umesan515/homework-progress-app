const { Pool } = require("pg");

const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER || "postgres",
      password: process.env.PGPASSWORD || process.env.PG_PASSWORD || "",
      database: process.env.PGDATABASE || "homework_app",
    };

const pool = new Pool(dbConfig);

module.exports = {
  dbConfig,
  pool,
};
