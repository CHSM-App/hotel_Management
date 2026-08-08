const { getPool, sql } = require('../../config/connection');
const { ApiError } = require('../../middleware/errorHandler');
const { PERMISSIONS, SYSTEM_ROLE_KEYS, isValidPermission } = require('./permissions');

function parsePermissions(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidPermission) : [];
  } catch {
    return [];
  }
}

function mapRole(row) {
  return {
    id: row.id,
    roleKey: row.role_key,
    name: row.name,
    description: row.description,
    isSystem: !!row.is_system,
    // A built-in the lodge has customised — the UI shows this so an owner can
    // tell "changed from the default" apart from "left as shipped".
    isOverridden: !!row.is_system && row.lodge_id != null,
    isCustom: !row.is_system,
    permissions: parsePermissions(row.permissions),
    isActive: !!row.is_active,
  };
}

// Effective roles for a lodge: every built-in, with any lodge-specific
// override swapped in, plus the lodge's own custom roles.
async function listRoles(lodgeId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .query(`
      SELECT id, lodge_id, role_key, name, description, is_system, permissions, is_active
      FROM dbo.roles
      WHERE lodge_id = @lodgeId OR lodge_id IS NULL
      ORDER BY is_system DESC, name ASC
    `);

  const byKey = new Map();
  for (const row of result.recordset) {
    const existing = byKey.get(row.role_key);
    // Lodge-scoped rows win over the shared default of the same key.
    if (!existing || (existing.lodge_id == null && row.lodge_id != null)) {
      byKey.set(row.role_key, row);
    }
  }

  const roles = Array.from(byKey.values()).map(mapRole);
  roles.sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
    if (a.isSystem) return SYSTEM_ROLE_KEYS.indexOf(a.roleKey) - SYSTEM_ROLE_KEYS.indexOf(b.roleKey);
    return a.name.localeCompare(b.name);
  });
  return roles;
}

async function getEffectiveRole(lodgeId, roleKey) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roleKey', sql.NVarChar, roleKey)
    .query(`
      SELECT TOP 1 id, lodge_id, role_key, name, description, is_system, permissions, is_active
      FROM dbo.roles
      WHERE role_key = @roleKey AND (lodge_id = @lodgeId OR lodge_id IS NULL)
      ORDER BY CASE WHEN lodge_id IS NULL THEN 1 ELSE 0 END
    `);
  const row = result.recordset[0];
  return row ? mapRole(row) : null;
}

function validatePermissions(permissions) {
  const bad = permissions.filter((p) => !isValidPermission(p));
  if (bad.length > 0) {
    throw new ApiError(`Unknown permission: ${bad[0]}.`, 400);
  }
  return Array.from(new Set(permissions));
}

async function createRole(lodgeId, input) {
  const pool = await getPool();
  const permissions = validatePermissions(input.permissions);

  // Slug from the display name, kept lodge-unique. Uppercase so custom keys
  // read the same way as the built-ins in the users table.
  const base = input.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!base) {
    throw new ApiError('Enter a role name using letters or numbers.', 400);
  }
  if (SYSTEM_ROLE_KEYS.includes(base)) {
    throw new ApiError('That name is reserved for a built-in role.', 409);
  }

  const clash = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roleKey', sql.NVarChar, base)
    .query('SELECT id FROM dbo.roles WHERE lodge_id = @lodgeId AND role_key = @roleKey');
  if (clash.recordset.length > 0) {
    throw new ApiError('A role with that name already exists.', 409);
  }

  const inserted = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roleKey', sql.NVarChar, base)
    .input('name', sql.NVarChar, input.name.trim())
    .input('description', sql.NVarChar, input.description?.trim() || null)
    .input('permissions', sql.NVarChar(sql.MAX), JSON.stringify(permissions))
    .query(`
      INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions)
      OUTPUT inserted.id
      VALUES (@lodgeId, @roleKey, @name, @description, 0, @permissions)
    `);

  return { id: inserted.recordset[0].id, roleKey: base };
}

// Saving a built-in writes a lodge-scoped copy the first time (the shared
// default row is never mutated — other lodges depend on it).
async function updateRolePermissions(lodgeId, roleKey, input) {
  const pool = await getPool();
  const permissions = validatePermissions(input.permissions);

  const current = await getEffectiveRole(lodgeId, roleKey);
  if (!current) {
    throw new ApiError('Role not found.', 404);
  }
  if (current.roleKey === 'OWNER' && !permissions.includes('staff.manage')) {
    throw new ApiError('Owner must keep access to Staff & roles, or nobody could manage them.', 400);
  }

  const owned = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roleKey', sql.NVarChar, roleKey)
    .query('SELECT id, is_system FROM dbo.roles WHERE lodge_id = @lodgeId AND role_key = @roleKey');

  const name = input.name?.trim();
  if (owned.recordset.length > 0) {
    await pool
      .request()
      .input('id', sql.BigInt, owned.recordset[0].id)
      .input('name', sql.NVarChar, current.isSystem ? current.name : name || current.name)
      .input('description', sql.NVarChar, input.description?.trim() ?? current.description ?? null)
      .input('permissions', sql.NVarChar(sql.MAX), JSON.stringify(permissions))
      .query(`
        UPDATE dbo.roles SET name = @name, description = @description, permissions = @permissions
        WHERE id = @id
      `);
  } else {
    await pool
      .request()
      .input('lodgeId', sql.BigInt, lodgeId)
      .input('roleKey', sql.NVarChar, roleKey)
      .input('name', sql.NVarChar, current.name)
      .input('description', sql.NVarChar, current.description)
      .input('isSystem', sql.Bit, current.isSystem ? 1 : 0)
      .input('permissions', sql.NVarChar(sql.MAX), JSON.stringify(permissions))
      .query(`
        INSERT INTO dbo.roles (lodge_id, role_key, name, description, is_system, permissions)
        VALUES (@lodgeId, @roleKey, @name, @description, @isSystem, @permissions)
      `);
  }

  return getEffectiveRole(lodgeId, roleKey);
}

// Drops the lodge's override so the built-in default applies again.
async function resetRole(lodgeId, roleKey) {
  if (!SYSTEM_ROLE_KEYS.includes(roleKey)) {
    throw new ApiError('Only built-in roles can be reset to defaults.', 400);
  }
  const pool = await getPool();
  await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roleKey', sql.NVarChar, roleKey)
    .query('DELETE FROM dbo.roles WHERE lodge_id = @lodgeId AND role_key = @roleKey AND is_system = 1');
  return getEffectiveRole(lodgeId, roleKey);
}

async function deleteRole(lodgeId, roleKey) {
  if (SYSTEM_ROLE_KEYS.includes(roleKey)) {
    throw new ApiError('Built-in roles can’t be deleted — reset it to defaults instead.', 400);
  }
  const pool = await getPool();

  const inUse = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roleKey', sql.NVarChar, roleKey)
    .query('SELECT COUNT(*) AS count FROM dbo.users WHERE lodge_id = @lodgeId AND role = @roleKey');
  if (inUse.recordset[0].count > 0) {
    throw new ApiError('Move the staff on this role to another role before deleting it.', 409);
  }

  const result = await pool
    .request()
    .input('lodgeId', sql.BigInt, lodgeId)
    .input('roleKey', sql.NVarChar, roleKey)
    .query('DELETE FROM dbo.roles OUTPUT deleted.id WHERE lodge_id = @lodgeId AND role_key = @roleKey AND is_system = 0');
  if (result.recordset.length === 0) {
    throw new ApiError('Role not found.', 404);
  }
}

module.exports = {
  PERMISSIONS,
  listRoles,
  getEffectiveRole,
  createRole,
  updateRolePermissions,
  resetRole,
  deleteRole,
};
