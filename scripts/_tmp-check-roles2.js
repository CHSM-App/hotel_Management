require('dotenv').config();
(async () => {
  const pool = await require('../src/config/connection').getPool();
  const roles = await pool.request().query("SELECT id, lodge_id, role_key, name, permissions FROM dbo.roles WHERE lodge_id IS NOT NULL");
  console.log(JSON.stringify(roles.recordset, null, 2));
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
