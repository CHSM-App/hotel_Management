const { Router } = require('express');
const { authenticate, requirePermission } = require('../../middleware/authenticate');
const { ApiError } = require('../../middleware/errorHandler');
const s = require('./bar.schema');
const svc = require('./bar.service');
const menuService = require('../menu/menu.service');

const router = Router();

// bar.manage: menu, stock, settings. bar.take: take orders and mark them delivered (captain).
// bar.bill: billing. bar.report: reports.
// The bar needs the menu to take an order, so reading it takes either of the first two.
const manage = [authenticate, requirePermission('bar.manage')];
const take = [authenticate, requirePermission('bar.take')];
const bill = [authenticate, requirePermission('bar.bill')];
const report = [authenticate, requirePermission('bar.report', 'bar.manage')];
const readMenu = [authenticate, requirePermission('bar.manage', 'bar.take', 'bar.bill')];

function parse(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(issue.message, 400, issue.path[0] ? String(issue.path[0]) : null);
  }
  return parsed.data;
}

// handler(req) -> JSON body. Keeps each route to one line.
const h = (fn, status = 200) => async (req, res, next) => {
  try {
    res.status(status).json(await fn(req));
  } catch (err) {
    next(err);
  }
};
const lodge = (req) => req.user.lodgeId;
const user = (req) => req.user.sub;
const id = (req, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError('Invalid id.', 400);
  return n;
};
const range = (req) => parse(s.rangeSchema, req.query);

router.get('/menu', ...readMenu, h((req) => svc.getMenu(lodge(req))));
router.get('/settings', ...readMenu, h((req) => svc.getSettings(lodge(req))));
router.patch('/settings', ...manage, h((req) => svc.updateSettings(lodge(req), parse(s.settingsSchema, req.body))));

router.post('/categories', ...manage, h((req) => svc.saveCategory(lodge(req), null, parse(s.categorySchema, req.body)), 201));
router.patch('/categories/:id', ...manage, h((req) => svc.saveCategory(lodge(req), id(req), parse(s.categorySchema, req.body))));

router.delete('/categories/:id', ...manage, h((req) => svc.deleteCategory(lodge(req), id(req))));

router.post('/products', ...manage, h((req) => svc.createProduct(lodge(req), parse(s.productSchema, req.body), user(req)), 201));
router.patch('/products/:id', ...manage, h((req) => svc.updateProduct(lodge(req), id(req), parse(s.productSchema, req.body))));
router.post('/products/:id/sizes', ...manage, h((req) => svc.addSize(lodge(req), id(req), parse(s.sizeSchema, req.body)), 201));
// ponytail: availability toggle needs bar.manage; add bar.bill if bartenders must flip it mid-service.
router.patch('/sizes/:id', ...manage, h((req) => svc.updateSize(lodge(req), id(req), parse(s.sizePatchSchema, req.body))));

router.post('/stock/:id/adjust', ...manage, h((req) => svc.adjustStock(lodge(req), id(req), parse(s.stockSchema, req.body), user(req))));
router.get('/stock/:id/movements', ...readMenu, h((req) => svc.listMovements(lodge(req), id(req), req.query.limit).then((movements) => ({ movements }))));

router.get('/orders/history', authenticate, requirePermission('bar.take', 'bar.bill'), h((req) => svc.listOrders(lodge(req), { status: 'HISTORY', ...range(req) }).then((orders) => ({ orders }))));
router.get('/bills', ...bill, h((req) => svc.listBills(lodge(req), range(req)).then((bills) => ({ bills }))));
router.get('/orders', authenticate, requirePermission('bar.take', 'bar.bill'), h((req) => svc.listOrders(lodge(req), { status: req.query.status === 'BILLED' ? 'BILLED' : 'OPEN' }).then((orders) => ({ orders }))));
router.post('/orders', ...take, h((req) => svc.createOrder(lodge(req), parse(s.orderSchema, req.body), user(req)), 201));
router.post('/orders/:id/items', ...take, h((req) => svc.addItems(lodge(req), id(req), parse(s.addItemsSchema, req.body), user(req))));
router.patch('/orders/:id/items/:itemId', ...take, h((req) => svc.updateItemQty(lodge(req), id(req), id(req, 'itemId'), parse(s.qtySchema, req.body).quantity, user(req))));
router.post('/orders/:id/items/:itemId/cancel', ...take, h((req) => svc.cancelItem(lodge(req), id(req), id(req, 'itemId'), user(req))));
router.post('/orders/:id/cancel', ...take, h((req) => svc.cancelOrder(lodge(req), id(req), user(req))));

router.get('/targets', ...take, h((req) => svc.listTargets(lodge(req))));
// Captain or the desk: either holding bar.take (captain) or bar.bill (reception) may mark it.
router.post('/orders/:id/ready-to-bill', authenticate, requirePermission('bar.take', 'bar.bill'), h((req) => svc.markReadyToBill(lodge(req), id(req))));
router.post('/orders/:id/add-to-room', authenticate, requirePermission('bar.take', 'bar.bill'), h((req) => svc.addToRoomBill(lodge(req), id(req), parse(s.roomBillSchema, req.body))));
router.post('/orders/:id/deliver', ...take, h((req) => svc.deliverAll(lodge(req), id(req))));
router.post('/orders/:id/items/:itemId/deliver', ...take, h((req) => svc.deliverItem(lodge(req), id(req), id(req, 'itemId'))));
// Restaurant food on a bar order is delivered through the kitchen's own flow (it must be ready first).
router.post('/food-orders/:id/items/:itemId/deliver', ...take, h((req) => svc.deliverFoodItem(lodge(req), id(req), id(req, 'itemId'))));
// The restaurant menu, so bar staff can add dishes without the food permissions.
router.get('/food-menu', ...take, h((req) => menuService.getMenu(lodge(req)).then((sections) => ({ sections }))));

router.get('/tabs', ...bill, h((req) => svc.listTabs(lodge(req)).then((tabs) => ({ tabs }))));
router.post('/bills', ...bill, h((req) => svc.issueBill(lodge(req), parse(s.billSchema, req.body), user(req)), 201));
router.get('/bills/:id', ...bill, h((req) => svc.getBill(lodge(req), id(req))));

router.get('/reports/sales', ...report, h((req) => svc.salesReport(lodge(req), range(req))));
router.get('/reports/stock', ...report, h((req) => svc.stockReport(lodge(req), range(req))));
router.get('/reports/bills', ...report, h((req) => svc.listBills(lodge(req), range(req)).then((bills) => ({ bills }))));

module.exports = router;
