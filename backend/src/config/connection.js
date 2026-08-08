const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        console.log(`Connected to SQL Server (${config.database}@${config.server}:${config.port})`);
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        console.error('SQL Server connection failed:', err.message);
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
