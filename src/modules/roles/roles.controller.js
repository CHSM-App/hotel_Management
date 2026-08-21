const { z } = require('zod');
const rolesService = require('./roles.service');
const { permissionsFor } = require('./permissions');
const { ApiError } = require('../../middleware/errorHandler');

const permissionsField = z.array(z.string()).default([]);

const createRoleSchema = z.object({
  name: z.string({ error: 'Enter a role name.' }).trim().min(1, 'Enter a role name.').max(60),
  description: z.string().trim().max(200).optional(),
  permissions: permissionsField,
});

const updateRoleSchema = z.object({
  name: z.string().trim().min(1, 'Enter a role name.').max(60).optional(),
  description: z.string().trim().max(200).optional(),
  permissions: permissionsField,
});

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

async function listRolesHandler(req, res, next) {
  try {
    const roles = await rolesService.listRoles(req.user.lodgeId);
    // The catalog ships with the roles so the UI never has to keep its own copy
    // of the permission list in sync with the backend's — and it is cut to what
    // this property can actually do, so a rooms-only lodge is never offered a
    // "Food orders" checkbox that grants access to a screen it doesn't have.
    const capabilities = await rolesService.getLodgeCapabilities(req.user.lodgeId);
    res.json({ roles, permissions: permissionsFor(capabilities) });
  } catch (err) {
    next(err);
  }
}

async function createRoleHandler(req, res, next) {
  try {
    const result = await rolesService.createRole(req.user.lodgeId, parse(createRoleSchema, req.body));
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateRoleHandler(req, res, next) {
  try {
    const role = await rolesService.updateRolePermissions(
      req.user.lodgeId,
      String(req.params.roleKey),
      parse(updateRoleSchema, req.body)
    );
    res.json({ role });
  } catch (err) {
    next(err);
  }
}

async function resetRoleHandler(req, res, next) {
  try {
    const role = await rolesService.resetRole(req.user.lodgeId, String(req.params.roleKey));
    res.json({ role });
  } catch (err) {
    next(err);
  }
}

async function deleteRoleHandler(req, res, next) {
  try {
    await rolesService.deleteRole(req.user.lodgeId, String(req.params.roleKey));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listRolesHandler,
  createRoleHandler,
  updateRoleHandler,
  resetRoleHandler,
  deleteRoleHandler,
};
