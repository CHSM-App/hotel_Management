import 'json.dart';

/// Other services — a private pool, a gaming area, anything a lodge sells
/// per use and bills like food. Mirrors ServicesPanel.jsx and
/// services.service.js field-for-field.

/// What a service is usually charged per. Anything else is typed under
/// "Other" — mirrors UNIT_SUGGESTIONS in ServicesPanel.jsx.
const kServiceUnitSuggestions = ['use', 'hour', 'day', 'person', 'session', 'game', 'trip', 'km'];

class LodgeService {
  final int id;
  final String name;
  final String unitLabel;
  final num price;
  final num gstRatePercent;
  final bool isActive;
  final bool isLaundry;
  final String? image;

  const LodgeService({
    required this.id,
    this.name = '',
    this.unitLabel = 'use',
    this.price = 0,
    this.gstRatePercent = 18,
    this.isActive = true,
    this.isLaundry = false,
    this.image,
  });

  factory LodgeService.fromJson(Map<String, dynamic> json) => LodgeService(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    unitLabel: asStringOrNull(json['unitLabel']) ?? 'use',
    price: asNum(json['price']),
    gstRatePercent: asNum(json['gstRatePercent'], fallback: 18),
    isActive: asBool(json['isActive']),
    isLaundry: asBool(json['isLaundry']),
    image: asStringOrNull(json['image']),
  );
}

const kServiceUsageStatusLabel = {'IN_USE': 'In use', 'COMPLETED': 'Completed', 'CANCELLED': 'Cancelled'};

/// One guest's (or walk-in's) use of a service, from start through to
/// billing — mirrors mapUsage in services.service.js.
class ServiceUsage {
  final int id;
  final int serviceId;
  final String serviceName;
  final String unitLabel;
  final num unitPrice;
  final num gstRatePercent;
  final num quantity;
  final num lineTotal;
  final int? roomId;
  final String? roomNumber;
  final int? bookingId;
  final String? guestName;
  final String? guestPhone;
  final String? note;
  final String status; // IN_USE | COMPLETED | CANCELLED
  final bool onRoomBill;
  final bool billed;
  final String startedAt;
  final String? completedAt;
  // Non-null when this use is one garment of a guest-laundry order — such
  // uses are billed and displayed as one group per order, not per garment.
  final int? laundryOrderId;

  const ServiceUsage({
    required this.id,
    this.serviceId = 0,
    this.serviceName = '',
    this.unitLabel = 'use',
    this.unitPrice = 0,
    this.gstRatePercent = 0,
    this.quantity = 1,
    this.lineTotal = 0,
    this.roomId,
    this.roomNumber,
    this.bookingId,
    this.guestName,
    this.guestPhone,
    this.note,
    this.status = 'IN_USE',
    this.onRoomBill = false,
    this.billed = false,
    this.startedAt = '',
    this.completedAt,
    this.laundryOrderId,
  });

  factory ServiceUsage.fromJson(Map<String, dynamic> json) => ServiceUsage(
    id: asInt(json['id']),
    serviceId: asInt(json['serviceId']),
    serviceName: asStringOrNull(json['serviceName']) ?? '',
    unitLabel: asStringOrNull(json['unitLabel']) ?? 'use',
    unitPrice: asNum(json['unitPrice']),
    gstRatePercent: asNum(json['gstRatePercent']),
    quantity: asNum(json['quantity'], fallback: 1),
    lineTotal: asNum(json['lineTotal']),
    roomId: asIntOrNull(json['roomId']),
    roomNumber: asStringOrNull(json['roomNumber']),
    bookingId: asIntOrNull(json['bookingId']),
    guestName: asStringOrNull(json['guestName']),
    guestPhone: asStringOrNull(json['guestPhone']),
    note: asStringOrNull(json['note']),
    status: asStringOrNull(json['status']) ?? 'IN_USE',
    onRoomBill: asBool(json['onRoomBill']),
    billed: asBool(json['billed']),
    startedAt: json['startedAt']?.toString() ?? '',
    completedAt: asStringOrNull(json['completedAt']),
    laundryOrderId: asIntOrNull(json['laundryOrderId']),
  );

  /// This use as the head of a new laundry group — same fields, named
  /// "Laundry" rather than the individual garment's own service name.
  ServiceUsage asLaundryHead() => ServiceUsage(
    id: id,
    serviceId: serviceId,
    serviceName: 'Laundry',
    unitLabel: unitLabel,
    unitPrice: unitPrice,
    gstRatePercent: gstRatePercent,
    quantity: quantity,
    lineTotal: lineTotal,
    roomId: roomId,
    roomNumber: roomNumber,
    bookingId: bookingId,
    guestName: guestName,
    guestPhone: guestPhone,
    note: note,
    status: status,
    onRoomBill: onRoomBill,
    billed: billed,
    startedAt: startedAt,
    completedAt: completedAt,
    laundryOrderId: laundryOrderId,
  );

  /// Folds another garment row of the same laundry order into this group's
  /// display row — quantity and total summed, mirrors groupedServiceUsages
  /// in Billing.jsx.
  ServiceUsage mergedWith(ServiceUsage other) => ServiceUsage(
    id: id,
    serviceId: serviceId,
    serviceName: 'Laundry',
    unitLabel: unitLabel,
    unitPrice: unitPrice,
    gstRatePercent: gstRatePercent,
    quantity: quantity + other.quantity,
    lineTotal: lineTotal + other.lineTotal,
    roomId: roomId,
    roomNumber: roomNumber,
    bookingId: bookingId,
    guestName: guestName,
    guestPhone: guestPhone,
    note: note,
    status: status,
    onRoomBill: onRoomBill,
    billed: billed,
    startedAt: startedAt,
    completedAt: completedAt,
    laundryOrderId: laundryOrderId,
  );

  /// "Completed · Room 12 · Asha · ready to bill" — mirrors the detail line
  /// built inline in ServicesPanel.jsx.
  String detailLine() {
    final parts = <String>[
      kServiceUsageStatusLabel[status] ?? status,
      if (roomNumber != null) 'Room $roomNumber',
      if (guestName != null && guestName!.isNotEmpty) guestName!,
      if (status == 'COMPLETED') (billed ? 'billed' : (onRoomBill ? 'on room bill' : 'ready to bill')),
    ];
    return parts.join(' · ');
  }
}
