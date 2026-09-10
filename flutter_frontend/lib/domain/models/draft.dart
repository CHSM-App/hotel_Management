/// The things the desk types into the booking form before the server sees any
/// of it. Held as its own file because the ViewModel, the screen and the form
/// builder all need the same shapes.
library;

import 'package:image_picker/image_picker.dart';

import 'json.dart';

// ── Constants the server enforces ───────────────────────────────────────────

/// Mirrors ID_PROOF_TYPES in bookings.schema.js. Anything else is rejected.
const kIdProofTypes = <String, String>{
  'AADHAAR': 'Aadhaar',
  'PAN': 'PAN',
  'PASSPORT': 'Passport',
  'DRIVING_LICENSE': 'Driving licence',
  'VOTER_ID': 'Voter ID',
  'OTHER': 'Other',
};

/// Mirrors PAYMENT_METHODS. UPI and card leave a reference the property
/// reconciles against its settlement statement; cash does not.
const kPaymentMethods = <String, String>{
  'CASH': 'Cash',
  'UPI': 'UPI',
  'CARD': 'Card',
};

bool needsPaymentReference(String? method) =>
    method == 'UPI' || method == 'CARD';

// ── One person on the booking ───────────────────────────────────────────────

/// An additional guest sharing the room.
///
/// The one whose name is on the booking is captured by the form's own fields;
/// these are everybody else. Each may carry their own ID, because a property
/// that has to produce a register does not get to record only one of the four
/// people who slept in the room.
class GuestDraft {
  /// Set only when this row already exists on the booking being edited —
  /// carrying it forward is what keeps an edit an edit rather than a delete
  /// and re-insert, so the row keeps whatever ID proof was already uploaded
  /// against it. Null on a new booking, and on a row added during an edit.
  int? id;

  String name;
  String phone;
  String? idProofType;
  String idProofNumber;
  bool isChild;

  /// A photo of the document, taken or picked fresh in this session — never
  /// carried over from an edit, since a guest whose document is already on
  /// file has nothing here to re-send.
  XFile? idProofFile;

  GuestDraft({
    this.id,
    this.name = '',
    this.phone = '',
    this.idProofType,
    this.idProofNumber = '',
    this.isChild = false,
    this.idProofFile,
  });

  bool get isEmpty => name.trim().isEmpty;

  /// The shape bookingGuestSchema (or editBookingGuestSchema, which only
  /// adds the optional id above) takes. Optional fields are left out
  /// entirely rather than sent empty — an empty string fails the enum and
  /// the length checks, where an absent key is simply "not recorded".
  Map<String, dynamic> toJson() => {
    if (id != null) 'id': id,
    'name': name.trim(),
    if (phone.trim().isNotEmpty) 'phone': phone.trim(),
    if (idProofType != null) 'idProofType': idProofType,
    if (idProofNumber.trim().isNotEmpty) 'idProofNumber': idProofNumber.trim(),
    'isChild': isChild,
  };
}

// ── One way the advance arrived ─────────────────────────────────────────────

/// A row of the advance.
///
/// A deposit is handed over part cash, part UPI often enough that recording one
/// method means filing the other half under a method it never used — wrong on
/// the receipt and wrong in the day's takings by mode.
class PaymentDraft {
  String? method;
  String amount;
  String reference;

  PaymentDraft({this.method, this.amount = '', this.reference = ''});

  num get value => num.tryParse(amount.trim()) ?? 0;

  Map<String, dynamic> toJson() => {
    'method': method,
    'amount': value,
    if (needsPaymentReference(method) && reference.trim().isNotEmpty)
      'reference': reference.trim(),
  };
}

/// What the rows add up to. Rounded, never left as a raw float sum: 600 + 900.10
/// is 1500.0999999999999 in binary floating point, and this figure is posted as
/// the amount taken.
num sumPayments(List<PaymentDraft> lines) {
  final total = lines.fold<num>(0, (sum, l) => sum + l.value);
  return (total * 100).round() / 100;
}

/// The first thing wrong going down the rows, or null.
String? paymentLinesError(List<PaymentDraft> lines) {
  for (final line in lines) {
    if (line.method == null) return 'Choose how each part was paid.';
    if (needsPaymentReference(line.method) && line.reference.trim().isEmpty) {
      return 'Enter the transaction number for a UPI or card payment.';
    }
    if (line.value <= 0) return 'Each payment must be more than zero.';
  }
  return null;
}

// ── An extra, as the desk has set it ────────────────────────────────────────

/// A switchable charge that is on the booking.
///
/// `agreedTotal` is what reception negotiated for the whole stay — "call it
/// 350" — held as typed rather than as a rate, because a total is what is
/// actually agreed at a counter. It is divided by the nights on the way out.
class ExtraDraft {
  int quantity;
  String agreedTotal;

  ExtraDraft({this.quantity = 1, this.agreedTotal = ''});
}

/// Mirrors VEHICLE_TYPES in bookings.schema.js.
const kVehicleTypes = <String, String>{
  'TWO_WHEELER': 'Two wheeler',
  'FOUR_WHEELER': 'Four wheeler',
  'TRAVELLER': 'Traveller',
  'BUS': 'Bus',
};

/// A vehicle parked against the stay — only ever editable, since the create
/// form never asked for one and the backend's own create schema carries no
/// field for it either.
class VehicleDraft {
  String number;
  String? type;

  VehicleDraft({this.number = '', this.type});

  bool get isEmpty => number.trim().isEmpty;

  Map<String, dynamic> toJson() => {'number': number.trim(), 'type': type};
}

// ── A parked booking form ───────────────────────────────────────────────────

/// GET /bookings/drafts's own row — everything the tape chart and the drafts
/// list need to draw the tile, plus the form itself for reopening it.
class BookingDraft {
  final int id;
  final int? roomId;
  final String? roomNumber;
  final String? categoryName;
  final String? guestName;
  final String? checkInDate;
  final String? checkOutDate;
  final String? updatedAt;
  final DraftForm form;

  const BookingDraft({
    required this.id,
    this.roomId,
    this.roomNumber,
    this.categoryName,
    this.guestName,
    this.checkInDate,
    this.checkOutDate,
    this.updatedAt,
    required this.form,
  });

  factory BookingDraft.fromJson(Map<String, dynamic> json) => BookingDraft(
    id: asInt(json['id']),
    roomId: asIntOrNull(json['roomId']),
    roomNumber: asStringOrNull(json['roomNumber']),
    categoryName: asStringOrNull(json['categoryName']),
    guestName: asStringOrNull(json['guestName']),
    checkInDate: asStringOrNull(json['checkInDate']),
    checkOutDate: asStringOrNull(json['checkOutDate']),
    updatedAt: asStringOrNull(json['updatedAt']),
    form: DraftForm.fromJson(
      (json['form'] as Map?)?.cast<String, dynamic>() ?? const {},
    ),
  );
}

/// The desk's own shape for a parked booking form, round-tripped whole
/// through the `form` field of POST/PUT /bookings/drafts. The server barely
/// validates it — the whole point of a draft is that it is allowed to be
/// wrong or half-finished — so parsing tolerates any piece of it being
/// missing rather than throwing, the same way the web form's own draft
/// restore does.
///
/// [adults]/[children] mirror the shape a web-saved draft already carries:
/// the primary guest is `adults[0]`, everyone else follows split the same
/// way — not a child by default, into [adults]; a child, into [children].
/// That split is also the one thing `usableDraft` on the web checks for, so
/// a draft either app saves stays openable by the other.
class DraftForm {
  int? roomId;
  DateTime? checkInDate;
  DateTime? checkOutDate;
  String guestName;
  String guestPhone;
  String? idProofType;
  String idProofNumber;

  /// Everyone besides the primary guest, in the order the form had them —
  /// [GuestDraft.isChild] says which of [adults]/[children] each lands in on
  /// the wire.
  List<GuestDraft> guests;
  List<VehicleDraft> vehicles;
  List<PaymentDraft> advanceLines;
  String roomTotal;
  String discount;

  /// chargeId → what was switched on for it, the same shape the booking form
  /// itself keeps live.
  Map<int, ExtraDraft> extras;

  DraftForm({
    this.roomId,
    this.checkInDate,
    this.checkOutDate,
    this.guestName = '',
    this.guestPhone = '',
    this.idProofType,
    this.idProofNumber = '',
    this.guests = const [],
    this.vehicles = const [],
    this.advanceLines = const [],
    this.roomTotal = '',
    this.discount = '',
    this.extras = const {},
  });

  factory DraftForm.fromJson(Map<String, dynamic> json) {
    final adults = (json['adults'] as List?) ?? const [];
    final children = (json['children'] as List?) ?? const [];
    final primary = adults.isNotEmpty
        ? (adults.first as Map?)?.cast<String, dynamic>()
        : null;

    GuestDraft guestFrom(Map<String, dynamic> g, bool isChild) => GuestDraft(
      name: g['name']?.toString() ?? '',
      phone: g['phone']?.toString() ?? '',
      idProofType: asStringOrNull(g['idProofType']),
      idProofNumber: g['idProofNumber']?.toString() ?? '',
      isChild: isChild,
    );

    final guests = <GuestDraft>[
      for (final g in adults.skip(1))
        guestFrom((g as Map).cast<String, dynamic>(), false),
      for (final g in children)
        guestFrom((g as Map).cast<String, dynamic>(), true),
    ];

    final vehicles = <VehicleDraft>[
      for (final v in (json['vehicles'] as List? ?? const []))
        VehicleDraft(
          number: (v as Map)['number']?.toString() ?? '',
          type: asStringOrNull(v['type']),
        ),
    ];

    final advanceLines = <PaymentDraft>[
      for (final p in (json['advanceLines'] as List? ?? const []))
        PaymentDraft(
          method: asStringOrNull((p as Map)['method']),
          amount: p['amount'] == null ? '' : '${p['amount']}',
          reference: p['reference']?.toString() ?? '',
        ),
    ];

    final extras = <int, ExtraDraft>{
      for (final e in (json['extras'] as List? ?? const []))
        if (asIntOrNull((e as Map)['id']) != null)
          asIntOrNull(e['id'])!: ExtraDraft(
            quantity: asInt(e['quantity'], fallback: 1),
            agreedTotal: e['agreedTotal'] == null ? '' : '${e['agreedTotal']}',
          ),
    };

    return DraftForm(
      roomId: asIntOrNull(json['roomId']),
      checkInDate: DateTime.tryParse(json['checkInDate']?.toString() ?? ''),
      checkOutDate: DateTime.tryParse(json['checkOutDate']?.toString() ?? ''),
      guestName: primary?['name']?.toString() ?? '',
      guestPhone: primary?['phone']?.toString() ?? '',
      idProofType: asStringOrNull(primary?['idProofType']),
      idProofNumber: primary?['idProofNumber']?.toString() ?? '',
      guests: guests,
      vehicles: vehicles,
      advanceLines: advanceLines,
      roomTotal: json['roomTotal']?.toString() ?? '',
      discount: json['discount']?.toString() ?? '',
      extras: extras,
    );
  }

  String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  /// The shape `bookingDraftSchema` accepts: `adults` non-empty, `children` an
  /// array — the two fields the web's own `usableDraft` checks for before it
  /// will reopen one.
  Map<String, dynamic> toJson() {
    final adults = guests.where((g) => !g.isChild).toList();
    final children = guests.where((g) => g.isChild).toList();

    Map<String, dynamic> guestJson(GuestDraft g) => {
      'name': g.name.trim(),
      if (g.phone.trim().isNotEmpty) 'phone': g.phone.trim(),
      if (g.idProofType != null) 'idProofType': g.idProofType,
      if (g.idProofNumber.trim().isNotEmpty)
        'idProofNumber': g.idProofNumber.trim(),
      'isChild': g.isChild,
    };

    return {
      if (roomId != null) 'roomId': roomId,
      if (checkInDate != null) 'checkInDate': _iso(checkInDate!),
      if (checkOutDate != null) 'checkOutDate': _iso(checkOutDate!),
      'adults': [
        {
          'name': guestName.trim(),
          if (guestPhone.trim().isNotEmpty) 'phone': guestPhone.trim(),
          if (idProofType != null) 'idProofType': idProofType,
          if (idProofNumber.trim().isNotEmpty)
            'idProofNumber': idProofNumber.trim(),
          'isChild': false,
        },
        ...adults.map(guestJson),
      ],
      'children': children.map(guestJson).toList(),
      'vehicles': vehicles
          .where((v) => !v.isEmpty)
          .map((v) => {'number': v.number.trim(), 'type': v.type})
          .toList(),
      'advanceLines': advanceLines
          .where((l) => l.value > 0)
          .map((l) => l.toJson())
          .toList(),
      if (roomTotal.trim().isNotEmpty) 'roomTotal': roomTotal.trim(),
      if (discount.trim().isNotEmpty) 'discount': discount.trim(),
      'extras': [
        for (final entry in extras.entries)
          {
            'id': entry.key,
            'quantity': entry.value.quantity,
            if (entry.value.agreedTotal.trim().isNotEmpty)
              'agreedTotal': entry.value.agreedTotal.trim(),
          },
      ],
    };
  }
}
