import 'json.dart';

export 'expense.dart' show kPaymentMethods, kPaymentMethodLabel, kPaymentReferenceLabel, kFrequencies, kFrequencyLabel, kPaymentStatuses;

/// Other income — money the property took in that isn't room/food/function
/// billing (interest, scrap sale, rent from a shop on the premises). Mirrors
/// income.service.js's mapCategory/mapIncome. Full CRUD, mirroring the
/// Expenses module — payers are the module's shared Vendor model (see
/// domain/models/asset.dart), stored through dbo.vendors with type 'income'.
class IncomeCategory {
  final int id;
  final String name;
  final bool isActive;

  const IncomeCategory({required this.id, this.name = '', this.isActive = true});

  factory IncomeCategory.fromJson(Map<String, dynamic> json) => IncomeCategory(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    isActive: asBool(json['isActive']),
  );
}

/// One logged receipt of other income — mirrors mapIncome in income.service.js.
class IncomeEntry {
  final int id;
  final int categoryId;
  final String categoryName;
  final int? payerId;
  final String? payerName;
  final int? recurringTemplateId;
  final String title;
  final String description;
  final num amount;
  final String paymentMethod;
  final String paymentStatus; // PAID | PARTIAL | PENDING
  final num? amountReceived;
  final String incomeDate;
  final bool hasReceiptDocument;
  final String createdAt;

  const IncomeEntry({
    required this.id,
    this.categoryId = 0,
    this.categoryName = '',
    this.payerId,
    this.payerName,
    this.recurringTemplateId,
    this.title = '',
    this.description = '',
    this.amount = 0,
    this.paymentMethod = 'CASH',
    this.paymentStatus = 'PAID',
    this.amountReceived,
    this.incomeDate = '',
    this.hasReceiptDocument = false,
    this.createdAt = '',
  });

  factory IncomeEntry.fromJson(Map<String, dynamic> json) => IncomeEntry(
    id: asInt(json['id']),
    categoryId: asInt(json['categoryId']),
    categoryName: asStringOrNull(json['categoryName']) ?? '',
    payerId: asIntOrNull(json['payerId']),
    payerName: asStringOrNull(json['payerName']),
    recurringTemplateId: asIntOrNull(json['recurringTemplateId']),
    title: asStringOrNull(json['title']) ?? '',
    description: asStringOrNull(json['description']) ?? '',
    amount: asNum(json['amount']),
    paymentMethod: asStringOrNull(json['paymentMethod']) ?? 'CASH',
    paymentStatus: asStringOrNull(json['paymentStatus']) ?? 'PAID',
    amountReceived: asNumOrNull(json['amountReceived']),
    incomeDate: asStringOrNull(json['incomeDate']) ?? '',
    hasReceiptDocument: asBool(json['hasReceiptDocument']),
    createdAt: json['createdAt']?.toString() ?? '',
  );
}

/// One receipt logged against an income entry — mirrors mapReceipt in
/// income.service.js and [ExpensePayment] in expense.dart. An income entry
/// can be settled in more than one instalment, so this is a running list
/// against an entry rather than a single field.
class IncomeReceipt {
  final int id;
  final int incomeId;
  final num amount;
  final String paymentMethod;
  final String? referenceNumber;
  final String receivedDate;
  final String createdAt;

  const IncomeReceipt({
    required this.id,
    this.incomeId = 0,
    this.amount = 0,
    this.paymentMethod = 'CASH',
    this.referenceNumber,
    this.receivedDate = '',
    this.createdAt = '',
  });

  factory IncomeReceipt.fromJson(Map<String, dynamic> json) => IncomeReceipt(
    id: asInt(json['id']),
    incomeId: asInt(json['incomeId']),
    amount: asNum(json['amount']),
    paymentMethod: asStringOrNull(json['paymentMethod']) ?? 'CASH',
    referenceNumber: asStringOrNull(json['referenceNumber']),
    receivedDate: asStringOrNull(json['receivedDate']) ?? '',
    createdAt: json['createdAt']?.toString() ?? '',
  );
}

/// Offered as suggestions, not a fixed list — mirrors SUGGESTED_CATEGORIES in
/// IncomePanel.jsx. A category only exists once it's been typed or picked and
/// used to save an income entry or recurring template; there is no separate
/// "manage categories" screen.
const kSuggestedIncomeCategories = [
  'Interest Earned',
  'Scrap Sale',
  'Rent Received',
  'Commission Received',
  'Refund Received',
  'Miscellaneous',
];

// Only PARTIAL/PENDING get a label — PAID (labelled "Received" here, since
// income is money coming in, not going out) is the default/common case, same
// reasoning as kPaymentStatusLabel in expense.dart.
const kIncomeStatusLabel = {'PARTIAL': 'Partially received', 'PENDING': 'Pending'};

/// A repeat schedule only — no amount. Those aren't known until the desk
/// actually logs an occurrence ("Log this month"), which creates a real
/// [IncomeEntry] with its own amount/payer/payment, linked back via
/// recurringTemplateId. Mirrors mapTemplate in income.service.js.
class IncomeRecurringTemplate {
  final int id;
  final int categoryId;
  final String categoryName;
  final int? payerId;
  final String? payerName;
  final String title;
  final String frequency; // MONTHLY | QUARTERLY | YEARLY
  final String nextDueDate;
  final bool isActive;

  const IncomeRecurringTemplate({
    required this.id,
    this.categoryId = 0,
    this.categoryName = '',
    this.payerId,
    this.payerName,
    this.title = '',
    this.frequency = 'MONTHLY',
    this.nextDueDate = '',
    this.isActive = true,
  });

  factory IncomeRecurringTemplate.fromJson(Map<String, dynamic> json) => IncomeRecurringTemplate(
    id: asInt(json['id']),
    categoryId: asInt(json['categoryId']),
    categoryName: asStringOrNull(json['categoryName']) ?? '',
    payerId: asIntOrNull(json['payerId']),
    payerName: asStringOrNull(json['payerName']),
    title: asStringOrNull(json['title']) ?? '',
    frequency: asStringOrNull(json['frequency']) ?? 'MONTHLY',
    nextDueDate: asStringOrNull(json['nextDueDate']) ?? '',
    isActive: asBool(json['isActive']),
  );
}

class IncomeMonthTotal {
  final int month;
  final num total;

  const IncomeMonthTotal({required this.month, this.total = 0});

  factory IncomeMonthTotal.fromJson(Map<String, dynamic> json) => IncomeMonthTotal(
    month: asInt(json['month']),
    total: asNum(json['total']),
  );
}

class IncomeCategoryTotal {
  final int categoryId;
  final String categoryName;
  final num total;

  const IncomeCategoryTotal({required this.categoryId, this.categoryName = '', this.total = 0});

  factory IncomeCategoryTotal.fromJson(Map<String, dynamic> json) => IncomeCategoryTotal(
    categoryId: asInt(json['categoryId']),
    categoryName: asStringOrNull(json['categoryName']) ?? '',
    total: asNum(json['total']),
  );
}

/// GET /income/summary in full — mirrors getMonthlySummary in
/// income.service.js.
class IncomeSummary {
  final List<IncomeMonthTotal> byMonth;
  final List<IncomeCategoryTotal> byCategory;

  const IncomeSummary({this.byMonth = const [], this.byCategory = const []});

  factory IncomeSummary.fromJson(Map<String, dynamic> json) => IncomeSummary(
    byMonth: (json['byMonth'] as List? ?? const [])
        .map((e) => IncomeMonthTotal.fromJson(e as Map<String, dynamic>))
        .toList(),
    byCategory: (json['byCategory'] as List? ?? const [])
        .map((e) => IncomeCategoryTotal.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  num get yearTotal => byMonth.fold<num>(0, (sum, m) => sum + m.total);
}
