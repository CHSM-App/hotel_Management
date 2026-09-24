const { z } = require('zod');

// Same preprocessor as assets.schema.js — a blank vendor/category picker
// arrives as '', not absent, and z.coerce.number() would otherwise turn that
// into 0 before .positive() rejects it with a message that names no field.
const optionalId = (message) =>
  z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.coerce.number().int().positive(message).nullable().optional()
  );

// CASH/UPI/CARD plus what else actually shows up on a vendor bill — a
// cheque, a bank transfer, a wallet payment, or something that fits none of
// those (OTHER). Same list assets.schema.js's paymentMethodSchema uses.
const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'WALLET', 'OTHER'];

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
  // Optional — not every vendor has one on file — but when given it has to
  // be a real 10-digit mobile number, same TEN_DIGITS rule bookings.schema.js
  // and staff.controller.js already use for guest/staff phone numbers.
  phone: z.string().trim().regex(/^$|^\d{10}$/, 'Enter a 10-digit mobile number.').optional().default(''),
  email: z.string().trim().max(120).optional().default(''),
  specialty: z.string().trim().max(80).optional().default(''),
  notes: z.string().trim().max(400).optional().default(''),
});

// vendorId and recurringTemplateId are both optional — an expense doesn't
// have to trace to a payee directory entry (a cash tip, a one-off purchase
// from someone who isn't a repeat vendor) or to a recurring template (most
// expenses are logged the day they happen, not generated from a schedule).
// paymentStatus defaults to PAID — the common case is logging a bill
// already settled. amountPaid only has to be sent (and is only validated
// against amount) when status is PARTIAL; see assertAmountPaid in
// expenses.service.js for the "can't exceed amount" check, which needs
// amount too and so can't live in a single-field Zod rule.
const expenseSchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a category.'),
  vendorId: optionalId(),
  // Set only when this expense is logging one occurrence of a recurring
  // template (see logRecurringOccurrence in expenses.service.js) — never
  // sent by the plain "New expense" form.
  recurringTemplateId: optionalId(),
  title: z.string().trim().min(1, 'Give this expense a title.').max(120),
  description: z.string().trim().max(400).optional().default(''),
  amount: z.coerce.number().min(0, 'Amount can’t be negative.'),
  // Meaningless while nothing's actually been paid — optional, and the
  // frontend hides the field entirely when paymentStatus is PENDING.
  paymentMethod: z.enum(PAYMENT_METHODS, { error: 'Choose how this was paid.' }).optional().default('CASH'),
  paymentStatus: z.enum(['PAID', 'PARTIAL', 'PENDING']).optional().default('PAID'),
  amountPaid: z.coerce.number().min(0, 'Amount paid can’t be negative.').optional().nullable(),
  referenceNumber: z.string().trim().max(80).optional().default(''),
  expenseDate: z.string().trim().min(1, 'Enter the expense date.').max(10),
});

// One payment against an expense — see dbo.expense_payments (migration 080).
// amount is checked against what's still owed in expenses.service.js's
// addPayment, not here, since that needs the expense row itself.
// referenceNumber is free text whose meaning follows paymentMethod (cheque
// number, UTR, transaction id, …) — optional even for a method that usually
// has one, since it isn't always on hand when the payment's logged.
const expensePaymentSchema = z.object({
  amount: z.coerce.number().positive('Enter how much was paid.'),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: 'Choose how this was paid.' }),
  referenceNumber: z.string().trim().max(80).optional().default(''),
  paidDate: z.string().trim().min(1, 'Enter when this was paid.').max(10),
});

// A template is a repeat schedule, not a commitment to an amount or a
// payee — how much rent/electricity/salaries actually costs is entered
// each cycle, at the point the desk logs that occurrence (see
// logRecurringOccurrence in expenses.service.js), not guessed once up
// front. amount/vendorId are gone from here entirely; nextDueDate is a
// reminder only ("Rent due in 3 days"), advanced by hand each time an
// occurrence is logged, never by a background job.
const recurringTemplateSchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a category.'),
  title: z.string().trim().min(1, 'Give this recurring expense a title.').max(120),
  frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY'], { error: 'Choose how often this repeats.' }),
  nextDueDate: z.string().trim().min(1, 'Enter the next due date.').max(10),
});

// Every field optional on update — deactivating a template only needs
// isActive, editing the title only needs title, and so on.
const updateRecurringTemplateSchema = z.object({
  categoryId: z.coerce.number().int().positive('Choose a category.').optional(),
  title: z.string().trim().min(1).max(120).optional(),
  frequency: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
  nextDueDate: z.string().trim().min(1).max(10).optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  categorySchema,
  updateCategorySchema,
  vendorSchema,
  expenseSchema,
  expensePaymentSchema,
  recurringTemplateSchema,
  updateRecurringTemplateSchema,
};
