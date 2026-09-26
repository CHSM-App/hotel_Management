import 'json.dart';
import 'room.dart' show RoomImage;

/// A hall or lawn that can be hired for a function — mirrors event_venues,
/// read the same way the web Setup tab's Venues card does.
class EventVenue {
  final int id;
  final String name;
  final int? capacityPax;
  final num baseCharge;
  final bool isActive;

  /// Uploaded to the same `{id, filename}` shape as [RoomImage] — the
  /// backend's event_venue_images table is modelled directly on room_images.
  final List<RoomImage> images;

  const EventVenue({
    required this.id,
    required this.name,
    this.capacityPax,
    this.baseCharge = 0,
    this.isActive = true,
    this.images = const [],
  });

  factory EventVenue.fromJson(Map<String, dynamic> json) => EventVenue(
    id: asInt(json['id']),
    name: json['name']?.toString() ?? '',
    capacityPax: asIntOrNull(json['capacityPax']),
    baseCharge: asNum(json['baseCharge']),
    isActive: json['isActive'] == null ? true : asBool(json['isActive']),
    images:
        (json['images'] as List?)?.map((e) => RoomImage.fromJson(e as Map<String, dynamic>)).toList() ?? const [],
  );
}

/// A catalogue extra quoted on top of the venue and plates — DJ, decor,
/// mandap. Mirrors event_addons.
class EventAddon {
  final int id;
  final String name;
  final num defaultAmount;
  final bool isPerUnit;
  final bool isActive;

  const EventAddon({
    required this.id,
    required this.name,
    this.defaultAmount = 0,
    this.isPerUnit = false,
    this.isActive = true,
  });

  factory EventAddon.fromJson(Map<String, dynamic> json) => EventAddon(
    id: asInt(json['id']),
    name: json['name']?.toString() ?? '',
    defaultAmount: asNum(json['defaultAmount']),
    isPerUnit: asBool(json['isPerUnit']),
    isActive: json['isActive'] == null ? true : asBool(json['isActive']),
  );
}

/// One add-on line on a function — either a catalogue pick (has [addonId])
/// or a typed one-off. [isExtra] marks one noted on the day rather than at
/// booking time; [needsPricing] is an unpriced extra still waiting on a
/// figure before the bill can be issued.
class EventAddonLine {
  final int? id;
  final int? addonId;
  final String label;
  final int quantity;
  final num? unitAmount;
  final num? agreedAmount;
  final bool isExtra;
  final bool needsPricing;
  final String? notedAt;

  const EventAddonLine({
    this.id,
    this.addonId,
    required this.label,
    this.quantity = 1,
    this.unitAmount,
    this.agreedAmount,
    this.isExtra = false,
    this.needsPricing = false,
    this.notedAt,
  });

  factory EventAddonLine.fromJson(Map<String, dynamic> json) => EventAddonLine(
    id: asIntOrNull(json['id']),
    addonId: asIntOrNull(json['addonId']),
    label: json['label']?.toString() ?? '',
    quantity: asInt(json['quantity'], fallback: 1),
    unitAmount: asNumOrNull(json['unitAmount']),
    agreedAmount: asNumOrNull(json['agreedAmount']),
    isExtra: asBool(json['isExtra']),
    needsPricing: asBool(json['needsPricing']),
    notedAt: asStringOrNull(json['notedAt']),
  );

  Map<String, dynamic> toJson() => {
    if (addonId != null) 'addonId': addonId,
    if (addonId == null) 'label': label,
    'quantity': quantity,
    if (agreedAmount != null) 'agreedAmount': agreedAmount,
  };
}

/// One priced line on the quote or the frozen bill — the venue hire,
/// catering, each add-on. [side] is 'VENUE' or 'FOOD', the two GST buckets
/// a function is taxed under.
class EventPricingLine {
  final String label;
  final num amount;
  final String? note;
  final String? side;

  /// What this line costs a day, and how many days it's billed for — set on
  /// add-on lines instead of [note] so the screen can build the same
  /// "rate × count" text the venue-hire line gets [note] pre-formatted with,
  /// using its own money formatter. Mirrors lineNote() in EventForm.jsx.
  final num? perDayAmount;
  final int? numberOfDays;

  const EventPricingLine({
    required this.label,
    required this.amount,
    this.note,
    this.side,
    this.perDayAmount,
    this.numberOfDays,
  });

  factory EventPricingLine.fromJson(Map<String, dynamic> json) => EventPricingLine(
    label: json['label']?.toString() ?? '',
    amount: asNum(json['amount']),
    note: asStringOrNull(json['note']),
    side: asStringOrNull(json['side']),
    perDayAmount: asNumOrNull(json['perDayAmount']),
    numberOfDays: asIntOrNull(json['numberOfDays']),
  );

  /// The note to show next to this line: the server's own text when it sent
  /// one (venue hire, catering), or a "rate × N days" built from
  /// [perDayAmount] for an add-on billed over more than one day.
  String? displayNote(String Function(num) formatPrice) {
    if ((numberOfDays ?? 1) > 1 && perDayAmount != null) {
      return '${formatPrice(perDayAmount!)} × $numberOfDays days';
    }
    return note;
  }
}

/// The full breakdown priceEvent() on the server returns — the live quote
/// while a form is filled in, and the frozen figure a saved booking carries.
class EventPricing {
  final List<EventPricingLine> lines;
  final int billablePax;
  final int numberOfDays;
  final num venueCharge;
  final num perPlateRate;
  final num cateringAmount;
  final num addonsTotal;
  final num grossAmount;
  final num discountAmount;
  final num totalAmount;

  const EventPricing({
    this.lines = const [],
    this.billablePax = 0,
    this.numberOfDays = 1,
    this.venueCharge = 0,
    this.perPlateRate = 0,
    this.cateringAmount = 0,
    this.addonsTotal = 0,
    this.grossAmount = 0,
    this.discountAmount = 0,
    this.totalAmount = 0,
  });

  factory EventPricing.fromJson(Map<String, dynamic> json) => EventPricing(
    lines: (json['lines'] as List? ?? [])
        .map((e) => EventPricingLine.fromJson(e as Map<String, dynamic>))
        .toList(),
    billablePax: asInt(json['billablePax']),
    numberOfDays: asInt(json['numberOfDays'], fallback: 1),
    venueCharge: asNum(json['venueCharge']),
    perPlateRate: asNum(json['perPlateRate']),
    cateringAmount: asNum(json['cateringAmount']),
    addonsTotal: asNum(json['addonsTotal']),
    grossAmount: asNum(json['grossAmount']),
    discountAmount: asNum(json['discountAmount']),
    totalAmount: asNum(json['totalAmount']),
  );
}

/// A saved invoice's own tiny summary, carried on the function once it is
/// billed — mirrors the invoice_json sub-select in events.service.js.
class EventInvoiceRef {
  final int id;
  final String? invoiceNumber;
  final String? status;
  final num totalAmount;

  const EventInvoiceRef({
    required this.id,
    this.invoiceNumber,
    this.status,
    this.totalAmount = 0,
  });

  factory EventInvoiceRef.fromJson(Map<String, dynamic> json) => EventInvoiceRef(
    id: asInt(json['id']),
    invoiceNumber: asStringOrNull(json['invoiceNumber']),
    status: asStringOrNull(json['status']),
    totalAmount: asNum(json['totalAmount']),
  );
}

/// One function booking — the diary/list row, and the detail screen's full
/// record. Mirrors mapEvent() in events.service.js.
class EventBooking {
  final int id;
  final int venueId;
  final String venueName;
  final int? venueCapacity;
  final String eventType;
  final String title;
  final String organiserName;
  final String organiserPhone;
  final String? organiserAltPhone;
  final String startAt;
  final String endAt;
  final String slot;
  final num expectedPax;
  final num guaranteedPax;
  final num? finalPax;
  final int billablePax;
  final num venueCharge;
  final num perPlateRate;
  final num discountAmount;
  final String? discountReason;
  final num totalAmount;
  final EventPricing? pricing;
  final num advanceAmount;
  final num balanceDue;
  final String? menuNotes;
  final String? setupNotes;
  final String? scheduleNotes;
  final bool roomsRequired;
  final int? roomsCount;
  final String? roomsFrom;
  final String? roomsTo;
  final String? roomsNotes;
  final String status;
  final String? holdExpiresAt;
  final String? cancelReason;
  final num? refundAmount;
  final String? refundPaymentMethod;
  final num? cancellationCharge;
  final List<EventAddonLine> addons;
  final EventInvoiceRef? invoice;

  const EventBooking({
    required this.id,
    required this.venueId,
    this.venueName = '',
    this.venueCapacity,
    required this.eventType,
    required this.title,
    required this.organiserName,
    required this.organiserPhone,
    this.organiserAltPhone,
    required this.startAt,
    required this.endAt,
    this.slot = 'CUSTOM',
    this.expectedPax = 0,
    this.guaranteedPax = 0,
    this.finalPax,
    this.billablePax = 0,
    this.venueCharge = 0,
    this.perPlateRate = 0,
    this.discountAmount = 0,
    this.discountReason,
    this.totalAmount = 0,
    this.pricing,
    this.advanceAmount = 0,
    this.balanceDue = 0,
    this.menuNotes,
    this.setupNotes,
    this.scheduleNotes,
    this.roomsRequired = false,
    this.roomsCount,
    this.roomsFrom,
    this.roomsTo,
    this.roomsNotes,
    this.status = 'ENQUIRY',
    this.holdExpiresAt,
    this.cancelReason,
    this.refundAmount,
    this.refundPaymentMethod,
    this.cancellationCharge,
    this.addons = const [],
    this.invoice,
  });

  factory EventBooking.fromJson(Map<String, dynamic> json) => EventBooking(
    id: asInt(json['id']),
    venueId: asInt(json['venueId']),
    venueName: json['venueName']?.toString() ?? '',
    venueCapacity: asIntOrNull(json['venueCapacity']),
    eventType: json['eventType']?.toString() ?? 'OTHER',
    title: json['title']?.toString() ?? '',
    organiserName: json['organiserName']?.toString() ?? '',
    organiserPhone: json['organiserPhone']?.toString() ?? '',
    organiserAltPhone: asStringOrNull(json['organiserAltPhone']),
    startAt: json['startAt']?.toString() ?? '',
    endAt: json['endAt']?.toString() ?? '',
    slot: json['slot']?.toString() ?? 'CUSTOM',
    expectedPax: asNum(json['expectedPax']),
    guaranteedPax: asNum(json['guaranteedPax']),
    finalPax: asNumOrNull(json['finalPax']),
    billablePax: asInt(json['billablePax']),
    venueCharge: asNum(json['venueCharge']),
    perPlateRate: asNum(json['perPlateRate']),
    discountAmount: asNum(json['discountAmount']),
    discountReason: asStringOrNull(json['discountReason']),
    totalAmount: asNum(json['totalAmount']),
    pricing: json['pricing'] is Map
        ? EventPricing.fromJson((json['pricing'] as Map).cast<String, dynamic>())
        : null,
    advanceAmount: asNum(json['advanceAmount']),
    balanceDue: asNum(json['balanceDue']),
    menuNotes: asStringOrNull(json['menuNotes']),
    setupNotes: asStringOrNull(json['setupNotes']),
    scheduleNotes: asStringOrNull(json['scheduleNotes']),
    roomsRequired: asBool(json['roomsRequired']),
    roomsCount: asIntOrNull(json['roomsCount']),
    roomsFrom: asStringOrNull(json['roomsFrom']),
    roomsTo: asStringOrNull(json['roomsTo']),
    roomsNotes: asStringOrNull(json['roomsNotes']),
    status: json['status']?.toString() ?? 'ENQUIRY',
    holdExpiresAt: asStringOrNull(json['holdExpiresAt']),
    cancelReason: asStringOrNull(json['cancelReason']),
    refundAmount: asNumOrNull(json['refundAmount']),
    refundPaymentMethod: asStringOrNull(json['refundPaymentMethod']),
    cancellationCharge: asNumOrNull(json['cancellationCharge']),
    addons: (json['addons'] as List? ?? [])
        .map((e) => EventAddonLine.fromJson(e as Map<String, dynamic>))
        .toList(),
    invoice: json['invoice'] is Map
        ? EventInvoiceRef.fromJson((json['invoice'] as Map).cast<String, dynamic>())
        : null,
  );

  /// A saved rate above zero is what "catering" means; there is no flag —
  /// same rule EventDetail.jsx's hasCatering uses.
  bool get hasCatering => perPlateRate > 0;

  bool get isClosed => status == 'CANCELLED' || status == 'EXPIRED';
}

/// GET /events/availability — whether a venue is free over a window, and
/// what it clashes with if not.
class EventAvailability {
  final bool available;
  final List<EventBooking> clashes;

  const EventAvailability({this.available = true, this.clashes = const []});

  factory EventAvailability.fromJson(Map<String, dynamic> json) => EventAvailability(
    available: asBool(json['available']),
    clashes: (json['clashes'] as List? ?? [])
        .map((e) => EventBooking.fromJson(e as Map<String, dynamic>))
        .toList(),
  );
}

/// POST /events/quote — the live price and capacity check a form debounces
/// into as the desk fills it in.
class EventQuoteResult {
  final EventPricing pricing;
  final String? overCapacity;

  const EventQuoteResult({required this.pricing, this.overCapacity});

  factory EventQuoteResult.fromJson(Map<String, dynamic> json) => EventQuoteResult(
    pricing: EventPricing.fromJson(
      (json['pricing'] as Map? ?? {}).cast<String, dynamic>(),
    ),
    overCapacity: asStringOrNull(json['overCapacity']),
  );
}

// ── Shared labels/colours — mirrors eventFormat.js ─────────────────────────

const kEventTypeLabel = <String, String>{
  'BIRTHDAY': 'Birthday',
  'WEDDING': 'Wedding',
  'RECEPTION': 'Reception',
  'ENGAGEMENT': 'Engagement',
  'CORPORATE': 'Corporate',
  'OTHER': 'Other',
};

const kEventStatusLabel = <String, String>{
  'ENQUIRY': 'Enquiry',
  'TENTATIVE': 'On hold',
  'CONFIRMED': 'Confirmed',
  'SETTLED': 'Settled',
  'CANCELLED': 'Cancelled',
  'EXPIRED': 'Expired',
};

const kSlotLabel = <String, String>{
  'MORNING': 'Morning',
  'EVENING': 'Evening',
  'FULL_DAY': 'Full day',
  'CUSTOM': 'Custom',
};

/// The default hours a slot stands for — picking one fills the times;
/// CUSTOM leaves them to be typed. Mirrors SLOT_HOURS.
const kSlotHours = <String, List<String>>{
  'MORNING': ['09:00', '15:00'],
  'EVENING': ['18:00', '23:00'],
  'FULL_DAY': ['09:00', '23:00'],
};
