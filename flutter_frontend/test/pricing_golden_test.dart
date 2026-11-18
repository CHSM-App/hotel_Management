import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/pricing/bill_pricing.dart';
import 'package:hotel_manager/domain/pricing/late_checkout_calc.dart';
import 'package:hotel_manager/domain/pricing/stay_pricing.dart';

/// The device prices a stay with no network, so it must agree with the server
/// to the paisa. pricing_golden.json is produced by running the server's own
/// functions (backend/scripts/dump-pricing-fixtures.js); regenerate it with
/// `node scripts/dump-pricing-fixtures.js` from backend/ when the server's
/// pricing changes, and this test says exactly which scenario now disagrees.
void main() {
  final golden =
      jsonDecode(File('test/fixtures/pricing_golden.json').readAsStringSync())
          as Map<String, dynamic>;

  group('quote matches the server', () {
    final quotes = (golden['quotes'] as List).cast<Map<String, dynamic>>();
    for (var i = 0; i < quotes.length; i++) {
      test('scenario $i', () {
        final inp = quotes[i]['input'] as Map<String, dynamic>;
        final exp = quotes[i]['expected'] as Map<String, dynamic>;
        final room = inp['room'] as Map<String, dynamic>;

        final q = StayPricing.quote(
          categoryName: room['categoryName'] as String,
          categoryBasePrice: room['categoryBasePrice'] as num,
          seasons: [
            for (final s in inp['seasons'] as List)
              PricingSeason.fromJson(s as Map<String, dynamic>),
          ],
          charges: [
            for (final c in inp['charges'] as List)
              PricingCharge.fromJson(c as Map<String, dynamic>),
          ],
          selections: [
            for (final s in inp['selections'] as List)
              ChargePick(
                (s as Map)['id'] as int,
                s['quantity'] as int,
                (s['agreedAmount'] as num?)?.toDouble(),
              ),
          ],
          checkIn: inp['checkIn'] as String,
          checkOut: inp['checkOut'] as String,
          basePriceOverride: inp['basePriceOverride'] as num?,
          discount: inp['discount'] as num,
        );

        expect(q.grossTotal, exp['grossTotal'], reason: 'grossTotal');
        expect(q.discountAmount, exp['discountAmount'], reason: 'discount');
        expect(q.totalPrice, exp['totalPrice'], reason: 'totalPrice');
        expect(
          [for (final n in q.nights) {'date': n.date, 'total': n.total}],
          exp['nights'],
          reason: 'nights',
        );
        expect(
          [
            for (final c in q.charges)
              {
                'label': c.label,
                'amount': c.amount,
                'isBase': c.isBase,
                'chargeId': c.chargeId,
                'quantity': c.quantity,
              },
          ],
          exp['charges'],
          reason: 'charge lines',
        );
      });
    }
  });

  group('bill matches the server', () {
    final bills = (golden['bills'] as List).cast<Map<String, dynamic>>();
    for (var i = 0; i < bills.length; i++) {
      test('scenario $i', () {
        final inp = bills[i]['input'] as Map<String, dynamic>;
        final exp = bills[i]['expected'] as Map<String, dynamic>;
        final foodRate = inp['foodRate'] as Map<String, dynamic>;

        final bill = priceStayBill(
          grossNights: (inp['amounts'] as List).cast<num>(),
          lateCheckoutCharge: inp['late'] as num,
          includeLateCheckout: inp['includeLate'] as bool,
          discountAmount: inp['discount'] as num,
          slabs: [
            for (final s in inp['slabs'] as List)
              BillSlab.fromJson(s as Map<String, dynamic>),
          ],
          gstRegistered: inp['gstRegistered'] as bool,
          foodSubtotals: [
            for (final f in inp['food'] as List) (f as Map)['subtotal'] as num,
          ],
          foodRate: FoodRate(foodRate['ratePercent'] as num, foodRate['sacCode'] as String?),
        );

        expect(bill.grossSubtotal, exp['grossSubtotal'], reason: 'grossSubtotal');
        expect(bill.discount, exp['discount'], reason: 'discount');
        expect(bill.nonGst, exp['nonGst'], reason: 'cash receipt');
        expect(bill.gst, exp['gst'], reason: 'GST document');
      });
    }
  });

  group('late checkout matches the server', () {
    final cases = (golden['late'] as List).cast<Map<String, dynamic>>();
    for (var i = 0; i < cases.length; i++) {
      test('scenario $i', () {
        final inp = cases[i]['input'] as Map<String, dynamic>;
        final exp = cases[i]['expected'] as Map<String, dynamic>;
        final p = inp['policy'] as Map<String, dynamic>;

        final out = lateCheckoutAnswer(
          bookingId: 1,
          checkinMode: inp['mode'] as String,
          checkInDate: inp['checkInDate'] as String,
          checkOutDate: inp['checkOutDate'] as String,
          checkOutTime: inp['checkOutTime'] as String,
          checkInTime: inp['checkInTime'] as String?,
          earlyArrivalFrom: inp['earlyArrivalFrom'] as String?,
          actualCheckInAt: DateTime.parse(inp['actualCheckInAt'] as String),
          at: DateTime.parse(inp['at'] as String),
          policy: LatePolicy(
            lateGraceMinutes: p['lateGraceMinutes'] as int,
            lateHalfDayPercent: p['lateHalfDayPercent'] as num,
            lateFullDayAfterMinutes: p['lateFullDayAfterMinutes'] as int,
            lateFullDayPercent: p['lateFullDayPercent'] as num,
          ),
          lastNightRate: inp['lastNightRate'] as num,
        );

        for (final key in [
          'plannedNights',
          'actualNights',
          'extraNights',
          'minutesLate',
          'lateLabel',
          'isLate',
          'isChargeable',
          'suggestedCharge',
          'band',
          'percent',
        ]) {
          expect(out[key], exp[key], reason: key);
        }
        // Same instant, written the same way the server writes it.
        expect(DateTime.parse(out['deadline'] as String).toUtc(),
            DateTime.parse(exp['deadline'] as String).toUtc(),
            reason: 'deadline');
      });
    }
  });
}
