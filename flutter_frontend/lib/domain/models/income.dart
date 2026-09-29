import 'json.dart';

/// Other income — money the property took in that isn't room/food/function
/// billing (interest, scrap sale, rent from a shop on the premises). Mirrors
/// income.service.js's mapCategory/mapIncome. Read-only on this side: the
/// Reports > Other Income tab only displays what's already logged, the same
/// way IncomeReportPanel.jsx is opened with `onClose={null}` — there is no
/// separate Income entry screen in this app yet.
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

// Only PARTIAL/PENDING get a label — PAID (labelled "Received" here, since
// income is money coming in, not going out) is the default/common case, same
// reasoning as kPaymentStatusLabel in expense.dart.
const kIncomeStatusLabel = {'PARTIAL': 'Partially received', 'PENDING': 'Pending'};
