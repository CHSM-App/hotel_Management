const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listStaffHandler,
  createStaffHandler,
  updateStaffHandler,
  resetStaffPasswordHandler,
} = require('./staff.controller');

const router = Router();

const canManageStaff = requirePermission('staff.manage');

router.get('/', authenticate, canManageStaff, listStaffHandler);
router.post('/', authenticate, canManageStaff, createStaffHandler);
router.patch('/:id', authenticate, canManageStaff, updateStaffHandler);
router.patch('/:id/password', authenticate, canManageStaff, resetStaffPasswordHandler);

module.exports = router;
