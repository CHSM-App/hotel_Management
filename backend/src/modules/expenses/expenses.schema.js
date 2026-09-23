const { z } = require('zod');

// Same preprocessor as assets.schema.js — a blank vendor/category picker
// arrives as '', not absent, and z.coerce.number() would otherwise turn that
// into 0 before .positive() rejects it with a message that names no field.
const optionalId = (message) =>
  z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.coerce.number().int().positive(message).nullable().optional()
  );

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.').max(80),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.').max(80).optional(),
  isActive: z.boolean().optional(),
});

const vendorSchema = z.object({
  name: z.string().trim().min(1, 'Vendor name is required.').max(120),
  contactPerson: z.string().trim().max(80).optional().default(''),
  phone: z.string().trim().max(20).optional().default(''),
  email: z.string().trim().max(120).optional().default(''),
  specialty: z.string().trim().max(80).optional().default(''),
  notes: z.string().trim().max(400).optional().default(''),
});

// vendorId and recurringTemplateId are both optional — an expense doesn't
// have to trace to a payee directory entry (a cash tip, a one-off purchase
// from someone who isn't a repeat vendor) or to a recurring template (most
// expenses are logged the day they happen, not generated from a schedule).
const expenseSchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a category.'),
  vendorId: optionalId(),
  title: z.string().trim().min(1, 'Give this expense a title.').max(120),
  description: z.string().trim().max(400).optional().default(''),
  amount: z.coerce.number().min(0, 'Amount can’t be negative.'),
  paymentMethod: z.enum(['CASH', 'UPI', 'CARD'], { error: 'Choose how this was paid.' }),
  expenseDate: z.string().trim().min(1, 'Enter the expense date.').max(10),
});

const recurringTemplateSchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a category.'),
  vendorId: optionalId(),
  title: z.string().trim().min(1, 'Give this recurring expense a title.').max(120),
  amount: z.coerce.number().min(0, 'Amount can’t be negative.'),
  frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY'], { error: 'Choose how often this repeats.' }),
  nextDueDate: z.string().trim().min(1, 'Enter the next due date.').max(10),
});

// Every field optional on update — deactivating a template only needs
// isActive, editing the amount only needs amount, and so on.
const updateRecurringTemplateSchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a category.').optional(),
  vendorId: optionalId(),
  title: z.string().trim().min(1).max(120).optional(),
  amount: z.coerce.number().min(0, 'Amount can’t be negative.').optional(),
  frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
  nextDueDate: z.string().trim().min(1).max(10).optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  categorySchema,
  updateCategorySchema,
  vendorSchema,
  expenseSchema,
  recurringTemplateSchema,
  updateRecurringTemplateSchema,
};
