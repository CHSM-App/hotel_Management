import 'json.dart';

/// GET /bookings/price-quote — what a stay costs, worked out by the server.
///
/// Priced server-side on purpose, and re-priced on every change. Taking money
/// off can move a night into a different GST band and change the rounding, so
/// the phone never adds up a stay itself: it shows what the server says and
/// sends back the same figures.
class Quote {
  /// One line per thing being charged: the room, any seasonal uplift, each
  /// extra. `isBase` marks the room's own line and `chargeId` marks an extra —
  /// both are editable at the desk, a season line is not.
  final List<QuoteLine> charges;

  /// Per night. Snapshotted onto the booking when it is saved, so a bill cut
  /// weeks later still shows what was actually charged rather than today's
  /// rates.
  final List<QuoteNight> nights;

  /// Before any concession.
  final num grossTotal;

  /// The concession actually applied — clamped by the server, which is why it
  /// is read back rather than assumed.
  final num discountAmount;

  /// What the stay costs: grossTotal less discountAmount.
  final num totalPrice;

  const Quote({
    this.charges = const [],
    this.nights = const [],
    this.grossTotal = 0,
    this.discountAmount = 0,
    this.totalPrice = 0,
  });

  factory Quote.fromJson(Map<String, dynamic> json) => Quote(
    charges:
        (json['charges'] as List?)
            ?.map((e) => QuoteLine.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    nights:
        (json['nights'] as List?)
            ?.map((e) => QuoteNight.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    grossTotal: asNum(json['grossTotal']),
    discountAmount: asNum(json['discountAmount']),
    totalPrice: asNum(json['totalPrice']),
  );

  int get nightCount => nights.length;
}

class QuoteLine {
  final String label;
  final num amount;

  /// The room's own line. Flagged rather than matched by label, because the
  /// label carries the price — it becomes "Deluxe ₹1,500 (custom)" the moment
  /// somebody negotiates one, and a match on the name would stop finding it at
  /// exactly that point.
  final bool isBase;

  /// Present on an extra's line, absent on the room and season lines.
  final int? chargeId;
  final int? quantity;

  /// Zero-based position in a multi-room quote; null for a single-room quote.
  final int? roomIndex;

  /// How many of the stay's nights this line applied to — only
  /// /pricing/simulate's lines carry it, so a quotation can print each
  /// line's own rate per night (amount / nights) even when a season line
  /// didn't run the whole stay.
  final int? nights;

  const QuoteLine({
    required this.label,
    required this.amount,
    this.isBase = false,
    this.chargeId,
    this.quantity,
    this.roomIndex,
    this.nights,
  });

  factory QuoteLine.fromJson(Map<String, dynamic> json) => QuoteLine(
    label: json['label']?.toString() ?? '',
    amount: asNum(json['amount']),
    isBase: asBool(json['isBase']),
    // switchable_charges.id is a BIGINT and arrives as a string.
    chargeId: asIntOrNull(json['chargeId']),
    quantity: asIntOrNull(json['quantity']),
    roomIndex: asIntOrNull(json['roomIndex']),
    nights: asIntOrNull(json['nights']),
  );

  bool get isExtra => chargeId != null;
}

class QuoteNight {
  final String date;
  final num total;

  const QuoteNight({required this.date, required this.total});

  factory QuoteNight.fromJson(Map<String, dynamic> json) => QuoteNight(
    date: json['date']?.toString() ?? '',
    total: asNum(json['total']),
  );
}

/// GET /bookings/price-quote's multi-room shape — one [RoomQuote] per room
/// being booked, plus the totals across all of them (the concession is
/// apportioned server-side, one room's worth per [RoomQuote.discountAmount]).
class MultiRoomQuote {
  final List<RoomQuote> rooms;
  final num grossTotal;
  final num discountAmount;
  final num totalPrice;

  const MultiRoomQuote({
    this.rooms = const [],
    this.grossTotal = 0,
    this.discountAmount = 0,
    this.totalPrice = 0,
  });

  factory MultiRoomQuote.fromJson(Map<String, dynamic> json) =>
      MultiRoomQuote(
        rooms:
            (json['rooms'] as List?)
                ?.map((e) => RoomQuote.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const [],
        grossTotal: asNum(json['grossTotal']),
        discountAmount: asNum(json['discountAmount']),
        totalPrice: asNum(json['totalPrice']),
      );
}

/// One room's slice of a [MultiRoomQuote].
class RoomQuote {
  final int roomId;
  final String checkInDate;
  final String checkOutDate;
  final List<QuoteNight> nights;
  final List<QuoteLine> charges;
  final num grossTotal;
  final num discountAmount;
  final num totalPrice;

  const RoomQuote({
    required this.roomId,
    required this.checkInDate,
    required this.checkOutDate,
    this.nights = const [],
    this.charges = const [],
    this.grossTotal = 0,
    this.discountAmount = 0,
    this.totalPrice = 0,
  });

  factory RoomQuote.fromJson(Map<String, dynamic> json) => RoomQuote(
    roomId: asInt(json['roomId']),
    checkInDate: json['checkInDate']?.toString() ?? '',
    checkOutDate: json['checkOutDate']?.toString() ?? '',
    nights:
        (json['nights'] as List?)
            ?.map((e) => QuoteNight.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    charges:
        (json['charges'] as List?)
            ?.map((e) => QuoteLine.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    grossTotal: asNum(json['grossTotal']),
    discountAmount: asNum(json['discountAmount']),
    totalPrice: asNum(json['totalPrice']),
  );
}

/// GET /pricing/simulate — a line-by-line breakdown for one room and a
/// stay, with no booking attached. Mirrors PriceSimulatorPanel.jsx; [lines]
/// and [nights] reuse [QuoteLine]/[QuoteNight] since the server shapes them
/// the same way price-quote does.
class PriceSimulation {
  final String roomNumber;
  final int nightCount;
  final List<QuoteLine> lines;
  final List<QuoteNight> nights;
  final num total;

  const PriceSimulation({
    this.roomNumber = '',
    this.nightCount = 0,
    this.lines = const [],
    this.nights = const [],
    this.total = 0,
  });

  factory PriceSimulation.fromJson(Map<String, dynamic> json) => PriceSimulation(
    roomNumber: json['roomNumber']?.toString() ?? '',
    nightCount: asInt(json['nightCount']),
    lines:
        (json['lines'] as List?)
            ?.map((e) => QuoteLine.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    nights:
        (json['nights'] as List?)
            ?.map((e) => QuoteNight.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    total: asNum(json['total']),
  );
}
