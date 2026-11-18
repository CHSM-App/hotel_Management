import 'stay_pricing.dart' show round2;

/// A stay's bill, worked out on the device.
///
/// A port of the server's billing.service.js — `taxWithin`, `computeGstBreakdown`,
/// `lateChargeTax`, `netOfDiscount`, `buildBreakdown`, `priceStayBill` — so a
/// guest can be checked out and billed with no network. Verified against the
/// server's own output in test/pricing_golden_test.dart.
///
/// Prices are what the guest hands over, GST already inside. Tax is therefore
/// extracted from an amount, not added to one, and each half of CGST/SGST is
/// rounded on its own, night by night, which is what keeps GSTR-1 reconciling.

class BillSlab {
  final num? maxAmount;
  final num ratePercent;
  final String? sacCode;

  const BillSlab({this.maxAmount, required this.ratePercent, this.sacCode});

  factory BillSlab.fromJson(Map<String, dynamic> j) => BillSlab(
    maxAmount: j['maxAmount'] as num?,
    ratePercent: (j['ratePercent'] as num?) ?? 0,
    sacCode: j['sacCode'] as String?,
  );
}

class FoodRate {
  final num ratePercent;
  final String? sacCode;
  const FoodRate(this.ratePercent, [this.sacCode]);
}

num _taxWithin(num inclusive, num ratePercent) {
  if (ratePercent == 0) return 0;
  return (inclusive * ratePercent) / (100 + ratePercent);
}

num _ratePercentFor(num amount, List<BillSlab> slabs) {
  for (final slab in slabs) {
    if (slab.maxAmount == null || amount <= slab.maxAmount!) return slab.ratePercent;
  }
  return 0;
}

double _cappedDiscount(num requested, num gross) {
  final amount = requested.toDouble();
  return round2((amount.isFinite ? amount : 0).clamp(0, gross).toDouble());
}

/// Each part gives up its share of the discount in proportion to its size,
/// before any of it is banded or taxed. Rounding drift goes on the largest
/// part (the first, on a tie), which is always big enough to absorb it.
List<double> netOfDiscount(List<num> amounts, double discount, num gross) {
  if (discount <= 0 || gross <= 0) return amounts.map(round2).toList();
  final shares = amounts.map((a) => round2((discount * a) / gross)).toList();
  final drift = round2(discount - shares.fold<double>(0, (s, x) => s + x));
  if (drift != 0) {
    var biggest = 0;
    for (var i = 0; i < amounts.length; i++) {
      if (amounts[i] > amounts[biggest]) biggest = i;
    }
    shares[biggest] = round2(shares[biggest] + drift);
  }
  return [for (var i = 0; i < amounts.length; i++) round2(amounts[i] - shares[i])];
}

class _Gst {
  final double cgst;
  final double sgst;
  final bool anyTaxable;
  const _Gst(this.cgst, this.sgst, this.anyTaxable);
}

_Gst _computeGstBreakdown(List<num> amounts, List<BillSlab> slabs) {
  double cgst = 0, sgst = 0;
  var anyTaxable = false;
  for (final amount in amounts) {
    final rate = _ratePercentFor(amount, slabs);
    if (rate > 0) anyTaxable = true;
    cgst += round2(_taxWithin(amount, rate) / 2);
    sgst += round2(_taxWithin(amount, rate) / 2);
  }
  return _Gst(round2(cgst), round2(sgst), anyTaxable);
}

class _LateTax {
  final double cgst;
  final double sgst;
  final bool taxable;
  const _LateTax(this.cgst, this.sgst, this.taxable);
}

/// A late checkout is part of the accommodation supply: it rides on the rate
/// the room's *final* night fell in, not the band the charge would land in on
/// its own.
_LateTax _lateChargeTax(num amount, List<num> amounts, List<BillSlab> slabs) {
  if (amount <= 0) return const _LateTax(0, 0, false);
  final rate = _ratePercentFor(amounts.isEmpty ? 0 : amounts.last, slabs);
  return _LateTax(
    round2(_taxWithin(amount, rate) / 2),
    round2(_taxWithin(amount, rate) / 2),
    rate > 0,
  );
}

double _ratePercentFromAmount(num tax, num subtotal) =>
    subtotal == 0 ? 0 : round2((tax / subtotal) * 100);

class _Side {
  final double subtotal;
  final double cgst;
  final double sgst;
  final bool taxable;
  final String? sacCode;
  const _Side(this.subtotal, this.cgst, this.sgst, this.taxable, this.sacCode);
}

Map<String, dynamic> _buildBreakdown({
  required double roomSubtotal,
  required double cgstAmount,
  required double sgstAmount,
  _Side? food,
  num discountAmount = 0,
}) {
  final foodSubtotal = food != null ? round2(food.subtotal) : 0.0;
  final foodCgst = food?.cgst ?? 0.0;
  final foodSgst = food?.sgst ?? 0.0;
  const serviceSubtotal = 0.0;

  final grossSubtotal = round2(roomSubtotal + foodSubtotal + serviceSubtotal);
  final discount = _cappedDiscount(discountAmount, grossSubtotal);
  final parts = netOfDiscount([round2(roomSubtotal), foodSubtotal, serviceSubtotal], discount, grossSubtotal);
  final roomGross = parts[0];
  final foodGross = parts[1];

  final roomNet = round2(roomGross - cgstAmount - sgstAmount);
  final foodNet = round2(foodGross - foodCgst - foodSgst);

  final subtotal = round2(grossSubtotal - discount);
  // The tax is already inside the subtotal, so the total is the subtotal,
  // rounded once to the whole rupee — the desk collects rupees.
  final totalAmount = _jsRound(subtotal);
  final roundOff = round2(totalAmount - subtotal);

  return {
    'subtotal': round2(roomSubtotal),
    'cgstAmount': cgstAmount,
    'sgstAmount': sgstAmount,
    'cgstRatePercent': _ratePercentFromAmount(cgstAmount, roomNet),
    'sgstRatePercent': _ratePercentFromAmount(sgstAmount, roomNet),
    'roomTaxable': roomNet,
    'foodSubtotal': foodSubtotal,
    'foodCgstAmount': foodCgst,
    'foodSgstAmount': foodSgst,
    'foodCgstRatePercent': _ratePercentFromAmount(foodCgst, foodNet),
    'foodSgstRatePercent': _ratePercentFromAmount(foodSgst, foodNet),
    'foodTaxable': foodNet,
    'foodSacCode': food?.sacCode,
    'serviceSubtotal': 0.0,
    'serviceCgstAmount': 0.0,
    'serviceSgstAmount': 0.0,
    'serviceCgstRatePercent': 0.0,
    'serviceSgstRatePercent': 0.0,
    'serviceTaxable': 0.0,
    'discountAmount': discount,
    'discountPercent': grossSubtotal > 0 ? round2((discount / grossSubtotal) * 100) : 0.0,
    'grossSubtotal': grossSubtotal,
    'combinedSubtotal': subtotal,
    'roundOff': roundOff,
    'totalAmount': totalAmount,
  };
}

// JS Math.round: half toward +infinity.
double _jsRound(num n) => (n + 0.5).floorToDouble();

class StayBill {
  /// Null when the property is not GST-registered.
  final Map<String, dynamic>? gst;
  final Map<String, dynamic> nonGst;
  final double nightsSubtotal;
  final double grossLate;
  final double grossSubtotal;
  final double discount;
  final List<double> grossNights;

  const StayBill({
    required this.gst,
    required this.nonGst,
    required this.nightsSubtotal,
    required this.grossLate,
    required this.grossSubtotal,
    required this.discount,
    required this.grossNights,
  });
}

/// Price a stay's bill both ways — as a GST document and as a cash receipt —
/// exactly as the server's `priceStayBill` does. Room, late charge and food;
/// other services are not supported offline (see [BillPricingUnsupported]).
StayBill priceStayBill({
  required List<num> grossNights,
  required num lateCheckoutCharge,
  required bool includeLateCheckout,
  required num discountAmount,
  required List<BillSlab> slabs,
  required bool gstRegistered,
  List<num> foodSubtotals = const [],
  FoodRate? foodRate,
}) {
  final nightsSubtotal = round2(grossNights.fold<num>(0, (s, n) => s + n));
  final grossLate = includeLateCheckout ? round2(lateCheckoutCharge) : 0.0;
  final grossFood = round2(foodSubtotals.fold<num>(0, (s, n) => s + n));
  const grossService = 0.0;
  final grossSubtotal = round2(nightsSubtotal + grossLate + grossFood + grossService);

  final discount = _cappedDiscount(discountAmount, grossSubtotal);
  final net = netOfDiscount([...grossNights, grossLate, grossFood, grossService], discount, grossSubtotal);
  final netNights = net.sublist(0, grossNights.length);
  final netLate = net[grossNights.length];
  final netFood = net[grossNights.length + 1];

  final g = _computeGstBreakdown(netNights, slabs);
  final late = _lateChargeTax(netLate, netNights, slabs);

  _Side? food;
  if (foodSubtotals.isNotEmpty) {
    final rate = foodRate ?? const FoodRate(0);
    final taxedOn = round2(netFood);
    final cgst = round2(_taxWithin(taxedOn, rate.ratePercent) / 2);
    final sgst = round2(_taxWithin(taxedOn, rate.ratePercent) / 2);
    food = _Side(grossFood, cgst, sgst, rate.ratePercent > 0 && taxedOn > 0, rate.sacCode);
  }

  final roomSubtotal = round2(nightsSubtotal + grossLate);

  Map<String, dynamic>? gst;
  if (gstRegistered) {
    final taxable = g.anyTaxable || late.taxable || (food?.taxable ?? false);
    gst = {
      'documentType': taxable ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY',
      ..._buildBreakdown(
        roomSubtotal: roomSubtotal,
        cgstAmount: round2(g.cgst + late.cgst),
        sgstAmount: round2(g.sgst + late.sgst),
        food: food,
        discountAmount: discount,
      ),
    };
  }

  final nonGst = {
    'documentType': 'CASH_RECEIPT',
    ..._buildBreakdown(
      roomSubtotal: roomSubtotal,
      cgstAmount: 0,
      sgstAmount: 0,
      food: food == null ? null : _Side(food.subtotal, 0, 0, food.taxable, food.sacCode),
      discountAmount: discount,
    ),
  };

  return StayBill(
    gst: gst,
    nonGst: nonGst,
    nightsSubtotal: nightsSubtotal,
    grossLate: grossLate,
    grossSubtotal: grossSubtotal,
    discount: discount,
    grossNights: [for (final n in grossNights) n.toDouble()],
  );
}

class BillPricingUnsupported implements Exception {
  final String message;
  BillPricingUnsupported(this.message);
  @override
  String toString() => message;
}
