const customersService = require('./customers.service');
const { createCustomerSchema, updateCustomerSchema } = require('./customers.schema');
const { ApiError } = require('../../middleware/errorHandler');

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

async function listCustomersHandler(req, res, next) {
  try {
    const { search, tag, optInOnly } = req.query;
    const result = await customersService.listCustomers(req.user.lodgeId, {
      search,
      tag,
      optInOnly: optInOnly === 'true',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function listFeedbackHandler(req, res, next) {
  try {
    res.json(await customersService.listFeedback(req.user.lodgeId));
  } catch (err) {
    next(err);
  }
}

async function getCustomerHandler(req, res, next) {
  try {
    const customer = await customersService.getCustomer(req.user.lodgeId, Number(req.params.id));
    res.json({ customer });
  } catch (err) {
    next(err);
  }
}

async function createCustomerHandler(req, res, next) {
  try {
    const customer = await customersService.createCustomer(req.user.lodgeId, parse(createCustomerSchema, req.body));
    res.status(201).json({ customer });
  } catch (err) {
    next(err);
  }
}

async function updateCustomerHandler(req, res, next) {
  try {
    const customer = await customersService.updateCustomer(
      req.user.lodgeId,
      Number(req.params.id),
      parse(updateCustomerSchema, req.body)
    );
    res.json({ customer });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCustomersHandler,
  listFeedbackHandler,
  getCustomerHandler,
  createCustomerHandler,
  updateCustomerHandler,
};
