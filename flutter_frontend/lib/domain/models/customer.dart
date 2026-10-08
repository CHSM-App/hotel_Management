import 'json.dart';

/// One guest this property has done business with — mirrors the web's
/// `mapCustomer` shape from customers.service.js. Auto-created/updated by the
/// backend whenever a room stay or event booking is made; the phone number
/// cannot be changed once created (it's the match key per lodge).
class Customer {
  final int id;
  final String name;
  final String phone;
  final String? email;
  final String? idProofType;
  final String? idProofNumber;
  final String? notes;
  final String? tags;
  final bool marketingOptIn;
  final int loyaltyPoints;
  final int totalStays;
  final num totalRoomSpend;
  final String? lastStayDate;
  final int totalEvents;
  final num totalEventSpend;
  final String? lastEventDate;
  final String? createdAt;

  const Customer({
    required this.id,
    required this.name,
    required this.phone,
    this.email,
    this.idProofType,
    this.idProofNumber,
    this.notes,
    this.tags,
    required this.marketingOptIn,
    this.loyaltyPoints = 0,
    this.totalStays = 0,
    this.totalRoomSpend = 0,
    this.lastStayDate,
    this.totalEvents = 0,
    this.totalEventSpend = 0,
    this.lastEventDate,
    this.createdAt,
  });

  num get totalSpend => totalRoomSpend + totalEventSpend;

  factory Customer.fromJson(Map<String, dynamic> json) => Customer(
    id: asInt(json['id']),
    name: json['name']?.toString() ?? '',
    phone: json['phone']?.toString() ?? '',
    email: asStringOrNull(json['email']),
    idProofType: asStringOrNull(json['idProofType']),
    idProofNumber: asStringOrNull(json['idProofNumber']),
    notes: asStringOrNull(json['notes']),
    tags: asStringOrNull(json['tags']),
    marketingOptIn: asBool(json['marketingOptIn']),
    loyaltyPoints: asInt(json['loyaltyPoints']),
    totalStays: asInt(json['totalStays']),
    totalRoomSpend: asNum(json['totalRoomSpend']),
    lastStayDate: asStringOrNull(json['lastStayDate']),
    totalEvents: asInt(json['totalEvents']),
    totalEventSpend: asNum(json['totalEventSpend']),
    lastEventDate: asStringOrNull(json['lastEventDate']),
    createdAt: asStringOrNull(json['createdAt']),
  );
}

/// One row in a customer's stay/event history, as returned alongside the
/// customer by GET /customers/:id.
class CustomerHistoryItem {
  final String? date;
  final String label;
  final String type;
  final String? status;
  final num amount;

  const CustomerHistoryItem({
    this.date,
    required this.label,
    required this.type,
    this.status,
    this.amount = 0,
  });

  factory CustomerHistoryItem.fromJson(Map<String, dynamic> json) =>
      CustomerHistoryItem(
        date: asStringOrNull(json['date']),
        label: json['label']?.toString() ?? '',
        type: json['type']?.toString() ?? '',
        status: asStringOrNull(json['status']),
        amount: asNum(json['amount']),
      );
}

/// GET /customers/:id's whole payload — the customer and their stay/event
/// history together, same as the web's profile modal fetch.
class CustomerDetail {
  final Customer customer;
  final List<CustomerHistoryItem> history;

  const CustomerDetail({required this.customer, required this.history});

  factory CustomerDetail.fromJson(Map<String, dynamic> json) => CustomerDetail(
    customer: Customer.fromJson(json),
    history: (json['history'] as List? ?? [])
        .map((e) => CustomerHistoryItem.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

/// GET /customers' stats tile — total customers on file and how many are
/// opted in to offers.
class CustomersStats {
  final int total;
  final int optedIn;

  const CustomersStats({this.total = 0, this.optedIn = 0});

  factory CustomersStats.fromJson(Map<String, dynamic> json) =>
      CustomersStats(total: asInt(json['total']), optedIn: asInt(json['optedIn']));
}

/// GET /customers' whole payload — the list and its stats tile, fetched
/// together so the screen never keeps its own running total by hand.
class CustomersResult {
  final List<Customer> customers;
  final CustomersStats stats;

  const CustomersResult({required this.customers, required this.stats});
}
