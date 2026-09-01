/// The things the desk types into the booking form before the server sees any
/// of it. Held as its own file because the ViewModel, the screen and the form
/// builder all need the same shapes.
library;

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
  String name;
  String phone;
  String? idProofType;
  String idProofNumber;
  bool isChild;

  GuestDraft({
    this.name = '',
    this.phone = '',
    this.idProofType,
    this.idProofNumber = '',
    this.isChild = false,
  });

  bool get isEmpty => name.trim().isEmpty;

  /// The shape bookingGuestSchema takes. Optional fields are left out entirely
  /// rather than sent empty — an empty string fails the enum and the length
  /// checks, where an absent key is simply "not recorded".
  Map<String, dynamic> toJson() => {
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
