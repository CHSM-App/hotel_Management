import 'json.dart';

List<T> _list<T>(dynamic v, T Function(Map<String, dynamic>) f) =>
    (v as List? ?? const []).map((e) => f(Map<String, dynamic>.from(e as Map))).toList();

/// Stock as the bar counts it: whole bottles plus loose ml.
String barStockText(int bottles, int looseMl) {
  if (bottles == 0 && looseMl == 0) return '0 ml';
  if (bottles == 0) return '$looseMl ml';
  if (looseMl == 0) return '$bottles btl';
  return '$bottles btl + $looseMl ml';
}

class BarCategory {
  final int id;
  final String name;
  final int sortOrder;
  final bool isActive;

  const BarCategory({required this.id, required this.name, this.sortOrder = 0, this.isActive = true});

  factory BarCategory.fromJson(Map<String, dynamic> j) => BarCategory(
    id: asInt(j['id']),
    name: j['name']?.toString() ?? '',
    sortOrder: asInt(j['sortOrder']),
    isActive: j['isActive'] == null ? true : asBool(j['isActive']),
  );
}

class BarSize {
  final int id;
  final String label;
  final int ml;
  final double price;
  final bool isAvailable;
  final bool isActive;

  const BarSize({
    required this.id,
    required this.label,
    required this.ml,
    required this.price,
    this.isAvailable = true,
    this.isActive = true,
  });

  factory BarSize.fromJson(Map<String, dynamic> j) => BarSize(
    id: asInt(j['id']),
    label: j['label']?.toString() ?? '',
    ml: asInt(j['ml']),
    price: asNum(j['price']).toDouble(),
    isAvailable: j['isAvailable'] == null ? true : asBool(j['isAvailable']),
    isActive: j['isActive'] == null ? true : asBool(j['isActive']),
  );
}

class BarProduct {
  final int id;
  final int? categoryId;
  final String name;
  final String? brand;
  final int bottleMl;
  final int stockMl;
  final int bottles;
  final int looseMl;
  final int? lowStockMl;
  final int? effectiveLowStockMl;
  final bool isLow;
  final bool isActive;
  final List<BarSize> sizes;

  const BarProduct({
    required this.id,
    this.categoryId,
    required this.name,
    this.brand,
    required this.bottleMl,
    required this.stockMl,
    required this.bottles,
    required this.looseMl,
    this.lowStockMl,
    this.effectiveLowStockMl,
    this.isLow = false,
    this.isActive = true,
    this.sizes = const [],
  });

  String get stockText => barStockText(bottles, looseMl);

  factory BarProduct.fromJson(Map<String, dynamic> j) => BarProduct(
    id: asInt(j['id']),
    categoryId: asIntOrNull(j['categoryId']),
    name: j['name']?.toString() ?? '',
    brand: asStringOrNull(j['brand']),
    bottleMl: asInt(j['bottleMl'], fallback: 750),
    stockMl: asInt(j['stockMl']),
    bottles: asInt(j['bottles']),
    looseMl: asInt(j['looseMl']),
    lowStockMl: asIntOrNull(j['lowStockMl']),
    effectiveLowStockMl: asIntOrNull(j['effectiveLowStockMl']),
    isLow: asBool(j['isLow']),
    isActive: j['isActive'] == null ? true : asBool(j['isActive']),
    sizes: _list(j['sizes'], BarSize.fromJson),
  );
}

class BarSettings {
  final double taxPercent;
  final int? defaultLowStockMl;

  const BarSettings({this.taxPercent = 0, this.defaultLowStockMl});

  factory BarSettings.fromJson(Map<String, dynamic> j) => BarSettings(
    taxPercent: asNum(j['taxPercent']).toDouble(),
    defaultLowStockMl: asIntOrNull(j['defaultLowStockMl']),
  );
}

class BarMenu {
  final List<BarCategory> categories;
  final List<BarProduct> products;
  final BarSettings settings;

  const BarMenu({this.categories = const [], this.products = const [], this.settings = const BarSettings()});

  factory BarMenu.fromJson(Map<String, dynamic> j) => BarMenu(
    categories: _list(j['categories'], BarCategory.fromJson),
    products: _list(j['products'], BarProduct.fromJson),
    settings: BarSettings.fromJson(Map<String, dynamic>.from((j['settings'] as Map?) ?? const {})),
  );
}

class BarMovement {
  final int id;
  final int changeMl;
  final int balanceAfter;
  final String reason;
  final String? note;
  final String? createdAt;

  const BarMovement({
    required this.id,
    required this.changeMl,
    required this.balanceAfter,
    required this.reason,
    this.note,
    this.createdAt,
  });

  factory BarMovement.fromJson(Map<String, dynamic> j) => BarMovement(
    id: asInt(j['id']),
    changeMl: asInt(j['changeMl']),
    balanceAfter: asInt(j['balanceAfter']),
    reason: j['reason']?.toString() ?? '',
    note: asStringOrNull(j['note']),
    createdAt: asStringOrNull(j['createdAt']),
  );
}

class BarOrderItem {
  final int id;
  final String name;
  final String size;
  final int ml;
  final double unitPrice;
  final int quantity;
  final double lineTotal;
  final bool delivered;

  const BarOrderItem({
    required this.id,
    required this.name,
    required this.size,
    this.ml = 0,
    this.unitPrice = 0,
    required this.quantity,
    required this.lineTotal,
    this.delivered = false,
  });

  factory BarOrderItem.fromJson(Map<String, dynamic> j) => BarOrderItem(
    id: asInt(j['id']),
    name: j['name']?.toString() ?? '',
    size: j['size']?.toString() ?? '',
    ml: asInt(j['ml']),
    unitPrice: asNum(j['unitPrice']).toDouble(),
    quantity: asInt(j['quantity']),
    lineTotal: asNum(j['lineTotal']).toDouble(),
    delivered: j['deliveredAt'] != null,
  );
}

/// A restaurant dish on a bar order: the kitchen cooks it, the bar bills it.
class BarFoodItem {
  final int id;
  final int foodOrderId;
  final String name;
  final String? portion;
  final int quantity;
  final double lineTotal;
  final bool delivered;

  /// QUEUED | PREPARING | READY | DELIVERED
  final String kitchenStatus;

  const BarFoodItem({
    required this.id,
    required this.foodOrderId,
    required this.name,
    this.portion,
    required this.quantity,
    required this.lineTotal,
    this.delivered = false,
    this.kitchenStatus = 'QUEUED',
  });

  bool get ready => kitchenStatus == 'READY';

  factory BarFoodItem.fromJson(Map<String, dynamic> j) => BarFoodItem(
    id: asInt(j['id']),
    foodOrderId: asInt(j['foodOrderId']),
    name: j['name']?.toString() ?? '',
    portion: asStringOrNull(j['portion']),
    quantity: asInt(j['quantity']),
    lineTotal: asNum(j['lineTotal']).toDouble(),
    delivered: j['deliveredAt'] != null,
    kitchenStatus: j['kitchenStatus']?.toString() ?? 'QUEUED',
  );
}

class BarOrder {
  final int id;
  final String? orderDate;
  final int orderNumber;

  /// COUNTER | TABLE | ROOM
  final String source;
  final int? tableId;
  final String? tableLabel;
  final int? roomId;
  final String? roomNumber;
  final int? bookingId;
  final String? guestName;
  final String? guestPhone;

  /// Who at the table the order is for; each customer is billed separately.
  final String? customerTag;
  final bool isParcel;

  /// OPEN | BILLED | CANCELLED
  final String status;
  final double subtotal;
  final int undelivered;
  final String? createdAt;
  final bool readyToBill;
  final int? billId;
  final String? billNumber;
  final String? roomInvoiceNumber;
  final List<BarOrderItem> items;
  final List<BarFoodItem> foodItems;

  const BarOrder({
    required this.id,
    this.orderDate,
    required this.orderNumber,
    required this.source,
    this.tableId,
    this.tableLabel,
    this.roomId,
    this.roomNumber,
    this.bookingId,
    this.guestName,
    this.guestPhone,
    this.customerTag,
    this.isParcel = false,
    required this.status,
    required this.subtotal,
    this.undelivered = 0,
    this.createdAt,
    this.readyToBill = false,
    this.billId,
    this.billNumber,
    this.roomInvoiceNumber,
    this.items = const [],
    this.foodItems = const [],
  });

  String get label => switch (source) {
    'TABLE' => 'Table ${tableLabel ?? tableId}',
    'ROOM' => 'Room ${roomNumber ?? roomId}',
    _ => isParcel ? 'Parcel' : 'Counter',
  };

  bool get isOpen => status == 'OPEN';

  factory BarOrder.fromJson(Map<String, dynamic> j) => BarOrder(
    id: asInt(j['id']),
    orderDate: asStringOrNull(j['orderDate']),
    orderNumber: asInt(j['orderNumber']),
    source: j['source']?.toString() ?? 'COUNTER',
    tableId: asIntOrNull(j['tableId']),
    tableLabel: asStringOrNull(j['tableLabel']),
    roomId: asIntOrNull(j['roomId']),
    roomNumber: asStringOrNull(j['roomNumber']),
    bookingId: asIntOrNull(j['bookingId']),
    guestName: asStringOrNull(j['guestName']),
    guestPhone: asStringOrNull(j['guestPhone']),
    customerTag: asStringOrNull(j['customerTag']),
    isParcel: j['isParcel'] == true,
    status: j['status']?.toString() ?? 'OPEN',
    subtotal: asNum(j['subtotal']).toDouble(),
    undelivered: asInt(j['undelivered']),
    createdAt: asStringOrNull(j['createdAt']),
    readyToBill: asBool(j['readyToBill']),
    billId: asIntOrNull(j['billId']),
    billNumber: asStringOrNull(j['billNumber']),
    roomInvoiceNumber: asStringOrNull(j['roomInvoiceNumber']),
    items: _list(j['items'], BarOrderItem.fromJson),
    foodItems: _list(j['foodItems'], BarFoodItem.fromJson),
  );
}

/// One bill-able group of ready orders: a table, a room or a counter order.
class BarTab {
  final String key;
  final String source;
  final String label;
  final String? guestName;
  final String? guestPhone;
  final int? roomId;
  final int? bookingId;
  final List<int> orderIds;
  final List<BarOrderItem> items;
  final List<BarFoodItem> foodItems;
  final int pendingDelivery;
  final double subtotal;

  const BarTab({
    required this.key,
    required this.source,
    required this.label,
    this.guestName,
    this.guestPhone,
    this.roomId,
    this.bookingId,
    this.orderIds = const [],
    this.items = const [],
    this.foodItems = const [],
    this.pendingDelivery = 0,
    required this.subtotal,
  });

  double get drinksTotal => items.fold(0.0, (s, i) => s + i.lineTotal);
  double get foodTotal => foodItems.fold(0.0, (s, i) => s + i.lineTotal);
  int get lineCount => items.length + foodItems.length;

  factory BarTab.fromJson(Map<String, dynamic> j) => BarTab(
    key: j['key']?.toString() ?? '',
    source: j['source']?.toString() ?? 'COUNTER',
    label: j['label']?.toString() ?? '',
    guestName: asStringOrNull(j['guestName']),
    guestPhone: asStringOrNull(j['guestPhone']),
    roomId: asIntOrNull(j['roomId']),
    bookingId: asIntOrNull(j['bookingId']),
    orderIds: (j['orderIds'] as List? ?? const []).map(asInt).toList(),
    items: _list(j['items'], BarOrderItem.fromJson),
    foodItems: _list(j['foodItems'], BarFoodItem.fromJson),
    pendingDelivery: asInt(j['pendingDelivery']),
    subtotal: asNum(j['subtotal']).toDouble(),
  );
}

class BarTable {
  final int id;
  final String label;

  const BarTable({required this.id, required this.label});
}

class BarGuest {
  final int roomId;
  final String roomNumber;
  final int bookingId;
  final String guestName;
  final String guestPhone;

  const BarGuest({
    required this.roomId,
    required this.roomNumber,
    required this.bookingId,
    this.guestName = '',
    this.guestPhone = '',
  });
}

class BarTargets {
  final List<BarTable> tables;
  final List<BarGuest> guests;

  const BarTargets({this.tables = const [], this.guests = const []});

  factory BarTargets.fromJson(Map<String, dynamic> j) => BarTargets(
    tables: _list(j['tables'], (t) => BarTable(id: asInt(t['id']), label: t['label']?.toString() ?? '')),
    guests: _list(
      j['guests'],
      (g) => BarGuest(
        roomId: asInt(g['roomId']),
        roomNumber: g['roomNumber']?.toString() ?? '',
        bookingId: asInt(g['bookingId']),
        guestName: g['guestName']?.toString() ?? '',
        guestPhone: g['guestPhone']?.toString() ?? '',
      ),
    ),
  );
}

class BarBillLine {
  final String kind;
  final String name;
  final String size;
  final double unitPrice;
  final int quantity;
  final double lineTotal;

  const BarBillLine({
    required this.kind,
    required this.name,
    this.size = '',
    required this.unitPrice,
    required this.quantity,
    required this.lineTotal,
  });

  factory BarBillLine.fromJson(Map<String, dynamic> j) => BarBillLine(
    kind: j['kind']?.toString() ?? 'DRINK',
    name: j['name']?.toString() ?? '',
    size: j['size']?.toString() ?? '',
    unitPrice: asNum(j['unitPrice']).toDouble(),
    quantity: asInt(j['quantity']),
    lineTotal: asNum(j['lineTotal']).toDouble(),
  );
}

class BarPayment {
  final String method;
  final double amount;
  final String? reference;

  const BarPayment({required this.method, required this.amount, this.reference});

  factory BarPayment.fromJson(Map<String, dynamic> j) => BarPayment(
    method: j['method']?.toString() ?? '',
    amount: asNum(j['amount']).toDouble(),
    reference: asStringOrNull(j['reference']),
  );
}

class BarBill {
  final int id;
  final String billNumber;
  final String? billDate;
  final double subtotal;
  final double drinksSubtotal;
  final double foodSubtotal;
  final double taxPercent;
  final double taxAmount;
  final double foodTaxPercent;
  final double foodTaxAmount;
  final double total;
  final String? customerName;
  final String? customerPhone;
  final String? createdAt;
  final List<BarBillLine> items;
  final List<BarBillLine> foodItems;
  final List<BarPayment> payments;

  const BarBill({
    required this.id,
    required this.billNumber,
    this.billDate,
    this.subtotal = 0,
    this.drinksSubtotal = 0,
    this.foodSubtotal = 0,
    this.taxPercent = 0,
    this.taxAmount = 0,
    this.foodTaxPercent = 0,
    this.foodTaxAmount = 0,
    required this.total,
    this.customerName,
    this.customerPhone,
    this.createdAt,
    this.items = const [],
    this.foodItems = const [],
    this.payments = const [],
  });

  factory BarBill.fromJson(Map<String, dynamic> j) => BarBill(
    id: asInt(j['id']),
    billNumber: j['billNumber']?.toString() ?? '',
    billDate: asStringOrNull(j['billDate']),
    subtotal: asNum(j['subtotal']).toDouble(),
    drinksSubtotal: asNum(j['drinksSubtotal']).toDouble(),
    foodSubtotal: asNum(j['foodSubtotal']).toDouble(),
    taxPercent: asNum(j['taxPercent']).toDouble(),
    taxAmount: asNum(j['taxAmount']).toDouble(),
    foodTaxPercent: asNum(j['foodTaxPercent']).toDouble(),
    foodTaxAmount: asNum(j['foodTaxAmount']).toDouble(),
    total: asNum(j['total']).toDouble(),
    customerName: asStringOrNull(j['customerName']),
    customerPhone: asStringOrNull(j['customerPhone']),
    createdAt: asStringOrNull(j['createdAt']),
    items: _list(j['items'], BarBillLine.fromJson),
    foodItems: _list(j['foodItems'], BarBillLine.fromJson),
    payments: _list(j['payments'], BarPayment.fromJson),
  );
}

/// A row of the Bills tab (the list route sends less than a full bill).
class BarBillRow {
  final int id;
  final String billNumber;
  final String? billDate;
  final double total;
  final double taxAmount;
  final double foodTaxAmount;
  final double foodSubtotal;
  final String? customerName;

  const BarBillRow({
    required this.id,
    required this.billNumber,
    this.billDate,
    required this.total,
    this.taxAmount = 0,
    this.foodTaxAmount = 0,
    this.foodSubtotal = 0,
    this.customerName,
  });

  factory BarBillRow.fromJson(Map<String, dynamic> j) => BarBillRow(
    id: asInt(j['id']),
    billNumber: j['billNumber']?.toString() ?? '',
    billDate: asStringOrNull(j['billDate']),
    total: asNum(j['total']).toDouble(),
    taxAmount: asNum(j['taxAmount']).toDouble(),
    foodTaxAmount: asNum(j['foodTaxAmount']).toDouble(),
    foodSubtotal: asNum(j['foodSubtotal']).toDouble(),
    customerName: asStringOrNull(j['customerName']),
  );
}

// ───────────────────────────── reports ─────────────────────────────

class BarSalesDay {
  final String date;
  final int bills;
  final double total;

  const BarSalesDay({required this.date, required this.bills, required this.total});
}

class BarSalesItem {
  final String name;
  final String size;
  final int quantity;
  final int ml;
  final double amount;
  final String kind;

  const BarSalesItem({
    required this.name,
    this.size = '',
    required this.quantity,
    this.ml = 0,
    required this.amount,
    required this.kind,
  });
}

class BarSalesCategory {
  final String category;
  final int ml;
  final double amount;

  const BarSalesCategory({required this.category, this.ml = 0, required this.amount});
}

class BarSales {
  final String from;
  final String to;
  final int bills;
  final double total;
  final double tax;
  final double drinks;
  final double food;
  final double foodTax;
  final int roomInvoices;
  final double roomTotal;
  final List<BarSalesDay> byDay;
  final Map<String, double> byPayment;
  final List<BarSalesItem> byItem;
  final List<BarSalesCategory> byCategory;

  const BarSales({
    required this.from,
    required this.to,
    this.bills = 0,
    this.total = 0,
    this.tax = 0,
    this.drinks = 0,
    this.food = 0,
    this.foodTax = 0,
    this.roomInvoices = 0,
    this.roomTotal = 0,
    this.byDay = const [],
    this.byPayment = const {},
    this.byItem = const [],
    this.byCategory = const [],
  });

  factory BarSales.fromJson(Map<String, dynamic> j) {
    final room = Map<String, dynamic>.from((j['onRoomBill'] as Map?) ?? const {});
    return BarSales(
      from: j['from']?.toString() ?? '',
      to: j['to']?.toString() ?? '',
      bills: asInt(j['bills']),
      total: asNum(j['total']).toDouble(),
      tax: asNum(j['tax']).toDouble(),
      drinks: asNum(j['drinks']).toDouble(),
      food: asNum(j['food']).toDouble(),
      foodTax: asNum(j['foodTax']).toDouble(),
      roomInvoices: asInt(room['invoices']),
      roomTotal: asNum(room['total']).toDouble(),
      byDay: _list(
        j['byDay'],
        (d) => BarSalesDay(
          date: d['date']?.toString().split('T').first ?? '',
          bills: asInt(d['bills']),
          total: asNum(d['total']).toDouble(),
        ),
      ),
      byPayment: {
        for (final p in _list(j['byPayment'], (p) => p))
          p['method']?.toString() ?? '': asNum(p['amount']).toDouble(),
      },
      byItem: _list(
        j['byItem'],
        (i) => BarSalesItem(
          name: i['name']?.toString() ?? '',
          size: i['size']?.toString() ?? '',
          quantity: asInt(i['quantity']),
          ml: asInt(i['ml']),
          amount: asNum(i['amount']).toDouble(),
          kind: i['kind']?.toString() ?? 'DRINK',
        ),
      ),
      byCategory: _list(
        j['byCategory'],
        (c) => BarSalesCategory(
          category: c['category']?.toString() ?? '',
          ml: asInt(c['ml']),
          amount: asNum(c['amount']).toDouble(),
        ),
      ),
    );
  }
}

class BarStockQty {
  final int stockMl;
  final int bottles;
  final int looseMl;

  const BarStockQty({this.stockMl = 0, this.bottles = 0, this.looseMl = 0});

  String get text => barStockText(bottles, looseMl);

  factory BarStockQty.fromJson(dynamic v) {
    final j = v is Map ? Map<String, dynamic>.from(v) : const <String, dynamic>{};
    return BarStockQty(
      stockMl: asInt(j['stockMl']),
      bottles: asInt(j['bottles']),
      looseMl: asInt(j['looseMl']),
    );
  }
}

class BarStockRow {
  final int id;
  final String name;
  final String? brand;
  final int bottleMl;
  final BarStockQty opening;
  final BarStockQty purchased;
  final BarStockQty sold;
  final BarStockQty wastage;
  final BarStockQty adjustment;
  final BarStockQty closing;
  final BarStockQty current;
  final bool isLow;

  const BarStockRow({
    required this.id,
    required this.name,
    this.brand,
    required this.bottleMl,
    required this.opening,
    required this.purchased,
    required this.sold,
    required this.wastage,
    required this.adjustment,
    required this.closing,
    required this.current,
    this.isLow = false,
  });

  factory BarStockRow.fromJson(Map<String, dynamic> j) => BarStockRow(
    id: asInt(j['id']),
    name: j['name']?.toString() ?? '',
    brand: asStringOrNull(j['brand']),
    bottleMl: asInt(j['bottleMl'], fallback: 750),
    opening: BarStockQty.fromJson(j['opening']),
    purchased: BarStockQty.fromJson(j['purchased']),
    sold: BarStockQty.fromJson(j['sold']),
    wastage: BarStockQty.fromJson(j['wastage']),
    adjustment: BarStockQty.fromJson(j['adjustment']),
    closing: BarStockQty.fromJson(j['closing']),
    current: BarStockQty.fromJson(j['current']),
    isLow: asBool(j['isLow']),
  );
}

class BarReport {
  final BarSales sales;
  final List<BarStockRow> stock;
  final List<BarBillRow> bills;

  const BarReport({required this.sales, this.stock = const [], this.bills = const []});
}
