const { z } = require('zod');
const staffService = require('./staff.service');
const { ApiError } = require('../../middleware/errorHandler');

// A staff login is keyed on the phone number, so it is held to one shape: ten
// digits, nothing else. The form only lets ten digits be typed; this is what
// stops a stale form or a direct call storing anything else, and it is applied
// to staff only — an owner's number arrives through lodge registration, which
// records landlines and so keeps its own looser field.
const TEN_DIGIT_PHONE = /^\d{10}$/;
const phoneField = (schema) => schema.trim().regex(TEN_DIGIT_PHONE, 'Enter a 10-digit mobile number.');

const createStaffSchema = z.object({
  name: z.string({ error: 'Enter a name.' }).trim().min(1, 'Enter a name.').max(200),
  phone: phoneField(z.string({ error: 'Enter a phone number.' })),
  email: z.string().trim().email('Enter a valid email, or leave it blank.').optional().or(z.literal('')),
  roleKey: z.string({ error: 'Choose a role.' }).trim().min(1, 'Choose a role.'),
  tempPassword: z
    .string({ error: 'Set a temporary password.' })
    .min(8, 'Temporary password must be at least 8 characters.'),
});

const updateStaffSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(200).optional(),
  phone: phoneField(z.string()).optional(),
  email: z.string().trim().email('Enter a valid email, or leave it blank.').optional().or(z.literal('')),
  roleKey: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  tempPassword: z
    .string({ error: 'Set a temporary password.' })
    .min(8, 'Temporary password must be at least 8 characters.'),
});

function parse(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(parsed.error.issues[0].message, 400);
  }
  return parsed.data;
}

async function listStaffHandler(req, res, next) {
  try {
    const staff = await staffService.listStaff(req.user.lodgeId);
    res.json({ staff });
  } catch (err) {
    next(err);
  }
}

async function createStaffHandler(req, res, next) {
  try {
    const result = await staffService.createStaff(req.user.lodgeId, parse(createStaffSchema, req.body));
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function updateStaffHandler(req, res, next) {
  try {
    const staff = await staffService.updateStaff(
      req.user.lodgeId,
      Number(req.params.id),
      parse(updateStaffSchema, req.body)
    );
    res.json({ staff });
  } catch (err) {
    next(err);
  }
}

async function resetStaffPasswordHandler(req, res, next) {
  try {
    const { tempPassword } = parse(resetPasswordSchema, req.body);
    await staffService.resetStaffPassword(req.user.lodgeId, Number(req.params.id), tempPassword);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listStaffHandler,
  createStaffHandler,
  updateStaffHandler,
  resetStaffPasswordHandler,
};
