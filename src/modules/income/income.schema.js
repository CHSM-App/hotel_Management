const { z } = require('zod');

// Same preprocessor as expenses.schema.js/assets.schema.js — a blank
// payer/category picker arrives as '', not absent.
const optionalId = (message) =>
  z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.coerce.number().int().positive(message).nullable().optional()
  );

// Same wider vocabulary expenses.schema.js uses.
const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'WALLET', 'OTHER'];

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.').max(80),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required.').max(80).optional(),
  isActive: z.boolean().optional(),
});

// payerId/recurringTemplateId are both optional — an income entry doesn't
// have to trace to a payer directory entry (interest credited by the bank,
// scrap sold for cash) or to a recurring template (most income is logged
// the day it's received, not generated from a schedule). paymentStatus
// defaults to PAID — the common case is logging money already received.
const incomeEntrySchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a category.'),
  payerId: optionalId(),
  recurringTemplateId: optionalId(),
  title: z.string().trim().min(1, 'Give this income a title.').max(120),
  description: z.string().trim().max(400).optional().default(''),
  amount: z.coerce.number().min(0, 'Amount can’t be negative.'),
  paymentMethod: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.enum(PAYMENT_METHODS, { error: 'Choose how this was received.' }).optional().default('CASH')
  ),
  paymentStatus: z.enum(['PAID', 'PARTIAL', 'PENDING']).optional().default('PAID'),
  amountReceived: z.coerce.number().min(0, 'Amount received can’t be negative.').optional().nullable(),
  referenceNumber: z.string().trim().max(80).optional().default(''),
  incomeDate: z.string().trim().min(1, 'Enter the income date.').max(10),
});

// One receipt against an income entry — see dbo.income_receipts.
const incomeReceiptSchema = z.object({
  amount: z.coerce.number().positive('Enter how much was received.'),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: 'Choose how this was received.' }),
  referenceNumber: z.string().trim().max(80).optional().default(''),
  receivedDate: z.string().trim().min(1, 'Enter when this was received.').max(10),
});

const recurringTemplateSchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a category.'),
  payerId: optionalId(),
  title: z.string().trim().min(1, 'Give this recurring income a title.').max(120),
  frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY'], { error: 'Choose how often this repeats.' }),
  nextDueDate: z.string().trim().min(1, 'Enter the next due date.').max(10),
});

const updateRecurringTemplateSchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a category.').optional(),
  payerId: optionalId(),
  title: z.string().trim().min(1).max(120).optional(),
  frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
  nextDueDate: z.string().trim().min(1).max(10).optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  categorySchema,
  updateCategorySchema,
  incomeEntrySchema,
  incomeReceiptSchema,
  recurringTemplateSchema,
  updateRecurringTemplateSchema,
};
