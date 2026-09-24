import 'json.dart';

/// A grouping for operating spend — "Utilities", "Maintenance" — mirrors
/// mapCategory in expenses.service.js.
class ExpenseCategory {
  final int id;
  final String name;
  final bool isActive;

  const ExpenseCategory({required this.id, this.name = '', this.isActive = true});

  factory ExpenseCategory.fromJson(Map<String, dynamic> json) => ExpenseCategory(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    isActive: asBool(json['isActive']),
  );
}

/// One logged spend, mirroring mapExpense in expenses.service.js.
class Expense {
  final int id;
  final int categoryId;
  final String categoryName;
  final int? vendorId;
  final String? vendorName;
  final int? recurringTemplateId;
  final String title;
  final String description;
  final num amount;
  final String paymentMethod; // CASH | UPI | CARD | CHEQUE | BANK_TRANSFER | WALLET | OTHER
  final String paymentStatus; // PAID | PARTIAL | PENDING
  final num? amountPaid;
  final String expenseDate;
  final bool hasBillDocument;
  final String createdAt;

  const Expense({
    required this.id,
    this.categoryId = 0,
    this.categoryName = '',
    this.vendorId,
    this.vendorName,
    this.recurringTemplateId,
    this.title = '',
    this.description = '',
    this.amount = 0,
    this.paymentMethod = 'CASH',
    this.paymentStatus = 'PAID',
    this.amountPaid,
    this.expenseDate = '',
    this.hasBillDocument = false,
    this.createdAt = '',
  });

  factory Expense.fromJson(Map<String, dynamic> json) => Expense(
    id: asInt(json['id']),
    categoryId: asInt(json['categoryId']),
    categoryName: asStringOrNull(json['categoryName']) ?? '',
    vendorId: asIntOrNull(json['vendorId']),
    vendorName: asStringOrNull(json['vendorName']),
    recurringTemplateId: asIntOrNull(json['recurringTemplateId']),
    title: asStringOrNull(json['title']) ?? '',
    description: asStringOrNull(json['description']) ?? '',
    amount: asNum(json['amount']),
    paymentMethod: asStringOrNull(json['paymentMethod']) ?? 'CASH',
    paymentStatus: asStringOrNull(json['paymentStatus']) ?? 'PAID',
    amountPaid: asNumOrNull(json['amountPaid']),
    expenseDate: asStringOrNull(json['expenseDate']) ?? '',
    hasBillDocument: asBool(json['hasBillDocument']),
    createdAt: json['createdAt']?.toString() ?? '',
  );
}

/// One payment logged against an expense — mirrors mapPayment in
/// expenses.service.js. A bill can be settled in more than one payment, so
/// this is a running list against an expense rather than a single field.
class ExpensePayment {
  final int id;
  final int expenseId;
  final num amount;
  final String paymentMethod;
  final String? referenceNumber;
  final String paidDate;
  final String createdAt;

  const ExpensePayment({
    required this.id,
    this.expenseId = 0,
    this.amount = 0,
    this.paymentMethod = 'CASH',
    this.referenceNumber,
    this.paidDate = '',
    this.createdAt = '',
  });

  factory ExpensePayment.fromJson(Map<String, dynamic> json) => ExpensePayment(
    id: asInt(json['id']),
    expenseId: asInt(json['expenseId']),
    amount: asNum(json['amount']),
    paymentMethod: asStringOrNull(json['paymentMethod']) ?? 'CASH',
    referenceNumber: asStringOrNull(json['referenceNumber']),
    paidDate: asStringOrNull(json['paidDate']) ?? '',
    createdAt: json['createdAt']?.toString() ?? '',
  );
}

const kPaymentStatuses = ['PAID', 'PARTIAL', 'PENDING'];

// Only PARTIAL/PENDING get a label — PAID is the default/common case, same
// reasoning as PAYMENT_STATUS_LABEL in ExpensesPanel.jsx.
const kPaymentStatusLabel = {'PARTIAL': 'Partially paid', 'PENDING': 'Pending'};

/// Offered as suggestions, not a fixed list — mirrors SUGGESTED_CATEGORIES
/// in ExpensesPanel.jsx. A category only exists once it's been typed or
/// picked and used to save an expense; there is no separate "manage
/// categories" screen.
const kSuggestedExpenseCategories = [
  'Utilities',
  'Salaries & Wages',
  'Maintenance & Repairs',
  'Housekeeping & Supplies',
  'F&B / Kitchen Supplies',
  'Marketing',
  'Taxes & Licenses',
  'Miscellaneous',
];

// Same vocabulary as PAYMENT_METHOD_LABEL in paymentMethods.js — every place
// this app logs how a bill was paid uses this one list.
const kPaymentMethods = ['CASH', 'UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER', 'WALLET', 'OTHER'];
const kPaymentMethodLabel = {
  'CASH': 'Cash',
  'UPI': 'UPI',
  'CARD': 'Card',
  'CHEQUE': 'Cheque',
  'BANK_TRANSFER': 'Bank transfer',
  'WALLET': 'Wallet',
  'OTHER': 'Other',
};

// What the reference-number field is called for a given method — mirrors
// PAYMENT_REFERENCE_LABEL in paymentMethods.js. Cash has none; callers hide
// the field when this map has no entry for the selected method.
const kPaymentReferenceLabel = {
  'UPI': 'Transaction / UTR number',
  'CARD': 'Last 4 digits / transaction ID',
  'CHEQUE': 'Cheque number',
  'BANK_TRANSFER': 'UTR / transaction number',
  'WALLET': 'Transaction ID',
  'OTHER': 'Reference number',
};

/// A schedule that "Generate due" turns into real [Expense] rows once
/// [nextDueDate] arrives — mirrors mapTemplate in expenses.service.js.
class RecurringTemplate {
  final int id;
  final int categoryId;
  final String categoryName;
  final int? vendorId;
  final String? vendorName;
  final String title;
  final num amount;
  final String frequency; // MONTHLY | QUARTERLY | YEARLY
  final String nextDueDate;
  final bool isActive;

  const RecurringTemplate({
    required this.id,
    this.categoryId = 0,
    this.categoryName = '',
    this.vendorId,
    this.vendorName,
    this.title = '',
    this.amount = 0,
    this.frequency = 'MONTHLY',
    this.nextDueDate = '',
    this.isActive = true,
  });

  factory RecurringTemplate.fromJson(Map<String, dynamic> json) => RecurringTemplate(
    id: asInt(json['id']),
    categoryId: asInt(json['categoryId']),
    categoryName: asStringOrNull(json['categoryName']) ?? '',
    vendorId: asIntOrNull(json['vendorId']),
    vendorName: asStringOrNull(json['vendorName']),
    title: asStringOrNull(json['title']) ?? '',
    amount: asNum(json['amount']),
    frequency: asStringOrNull(json['frequency']) ?? 'MONTHLY',
    nextDueDate: asStringOrNull(json['nextDueDate']) ?? '',
    isActive: asBool(json['isActive']),
  );
}

const kFrequencies = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
const kFrequencyLabel = {'MONTHLY': 'Monthly', 'QUARTERLY': 'Quarterly', 'YEARLY': 'Yearly'};

class ExpenseMonthTotal {
  final int month;
  final num total;

  const ExpenseMonthTotal({required this.month, this.total = 0});

  factory ExpenseMonthTotal.fromJson(Map<String, dynamic> json) => ExpenseMonthTotal(
    month: asInt(json['month']),
    total: asNum(json['total']),
  );
}

class ExpenseCategoryTotal {
  final int categoryId;
  final String categoryName;
  final num total;

  const ExpenseCategoryTotal({required this.categoryId, this.categoryName = '', this.total = 0});

  factory ExpenseCategoryTotal.fromJson(Map<String, dynamic> json) => ExpenseCategoryTotal(
    categoryId: asInt(json['categoryId']),
    categoryName: asStringOrNull(json['categoryName']) ?? '',
    total: asNum(json['total']),
  );
}

/// GET /expenses/summary in full — mirrors getMonthlySummary in
/// expenses.service.js.
class ExpenseSummary {
  final List<ExpenseMonthTotal> byMonth;
  final List<ExpenseCategoryTotal> byCategory;

  const ExpenseSummary({this.byMonth = const [], this.byCategory = const []});

  factory ExpenseSummary.fromJson(Map<String, dynamic> json) => ExpenseSummary(
    byMonth: (json['byMonth'] as List? ?? const [])
        .map((e) => ExpenseMonthTotal.fromJson(e as Map<String, dynamic>))
        .toList(),
    byCategory: (json['byCategory'] as List? ?? const [])
        .map((e) => ExpenseCategoryTotal.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  num get yearTotal => byMonth.fold<num>(0, (sum, m) => sum + m.total);
}
