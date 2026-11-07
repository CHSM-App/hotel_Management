const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const {
  listSeasonsHandler,
  createSeasonHandler,
  updateSeasonHandler,
  deleteSeasonHandler,
} = require('./seasons.controller');

const router = Router();

router.get('/', authenticate, requirePermission('rooms.manage'), listSeasonsHandler);
router.post('/', authenticate, requirePermission('rooms.manage'), createSeasonHandler);
router.patch('/:id', authenticate, requirePermission('rooms.manage'), updateSeasonHandler);
router.delete('/:id', authenticate, requirePermission('rooms.manage'), deleteSeasonHandler);

module.exports = router;
