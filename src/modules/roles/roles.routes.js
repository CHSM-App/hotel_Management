const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listRolesHandler,
  createRoleHandler,
  updateRoleHandler,
  resetRoleHandler,
  deleteRoleHandler,
} = require('./roles.controller');

const router = Router();

const canManageStaff = requirePermission('staff.manage');

router.get('/', authenticate, canManageStaff, listRolesHandler);
router.post('/', authenticate, canManageStaff, createRoleHandler);
router.patch('/:roleKey', authenticate, canManageStaff, updateRoleHandler);
router.patch('/:roleKey/reset', authenticate, canManageStaff, resetRoleHandler);
router.delete('/:roleKey', authenticate, canManageStaff, deleteRoleHandler);

module.exports = router;
