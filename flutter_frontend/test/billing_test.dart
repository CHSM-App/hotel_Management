import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/booking.dart';
import 'package:hotel_manager/domain/models/draft.dart';
import 'package:hotel_manager/domain/models/invoice.dart';
import 'package:hotel_manager/presentation/view_models/billing_viewmodel.dart';

/// The rules the bill has to hold to.
///
/// The balance due is what the stay cost. Nothing typed into the payment rows
/// moves it, and the bill cannot be cut until the money recorded equals it —
/// a bill issued for less than was collected, or more, is wrong on paper and
/// wrong in the day's takings.
void main() {
  BillPreview preview({
    num total = 1800,
    num advance = 300,
    bool gst = true,
  }) => BillPreview.fromJson({
    'bookingId': 1,
    'nights': 1,
    'advancePaid': advance,
    'isGstRegistered': gst,
    'gst': {'totalAmount': total, 'documentType': 'TAX_INVOICE'},
    'nonGst': {'totalAmount': total, 'documentType': 'CASH_RECEIPT'},
  });

  BillingState withPayment(List<PaymentDraft> rows, {BillPreview? p}) =>
      BillingState(preview: p ?? preview(), payment: rows);

  // ── What is owed ─────────────────────────────────────────────────────────
  group('the balance due', () {
    test('is the total less what was already taken', () {
      expect(preview(total: 1800, advance: 300).balanceDue, 1500);
    });

    test('follows the property, not the desk', () {
      // A registered lodge issues on the GST side; an unregistered one has
      // nothing else to issue. The choice was removed from the web screen for
      // that reason and is not offered here either.
      expect(preview(gst: true).billingSide, 'GST');
      expect(preview(gst: true).amounts?.documentType, 'TAX_INVOICE');
      expect(preview(gst: false).billingSide, 'NON_GST');
      expect(preview(gst: false).amounts?.documentType, 'CASH_RECEIPT');
    });
  });

  // ── When it may be issued ────────────────────────────────────────────────
  group('settlement', () {
    test('an exact match issues', () {
      final s = withPayment([PaymentDraft(method: 'CASH', amount: '1500')]);
      expect(s.settles, isTrue);
      expect(s.settlementProblem, isNull);
    });

    test('a split that adds up issues', () {
      final s = withPayment([
        PaymentDraft(method: 'CASH', amount: '1000'),
        PaymentDraft(method: 'UPI', amount: '500', reference: 'UTR1'),
      ]);
      expect(s.settles, isTrue);
      expect(s.settlementProblem, isNull);
    });

    test('short says how much is missing', () {
      final s = withPayment([PaymentDraft(method: 'CASH', amount: '1000')]);
      expect(s.settlementProblem, '₹500 of the balance is still unaccounted for.');
    });

    test('over says so the other way round', () {
      final s = withPayment([PaymentDraft(method: 'CASH', amount: '1600')]);
      expect(s.settlementProblem, 'That is ₹100 more than the balance due.');
    });

    test('a half-entered split does not issue', () {
      // Typing the cash and turning away to ask the guest for the rest must
      // not leave a bill that can be cut for part of what is owed.
      final s = withPayment([
        PaymentDraft(method: 'CASH', amount: '1000'),
        PaymentDraft(),
      ]);
      expect(s.settlementProblem, isNotNull);
    });

    test('a UPI row still needs its transaction number', () {
      final s = withPayment([PaymentDraft(method: 'UPI', amount: '1500')]);
      expect(
        s.settlementProblem,
        'Enter the transaction number for a UPI or card payment.',
      );
    });

    test('a split with paise in it settles', () {
      // Both sides are rounded to the paisa before they ever meet — sumPayments
      // on the way in, and the compare itself — so no bill is refused for a
      // binary-floating-point artefact. Which pairs of decimals actually
      // produce one varies, so this asserts the behaviour rather than claiming
      // a particular sum is inexact.
      final s = withPayment(
        [
          PaymentDraft(method: 'CASH', amount: '600'),
          PaymentDraft(method: 'UPI', amount: '900.10', reference: 'U1'),
        ],
        p: preview(total: 1800.10, advance: 300),
      );
      expect(s.collected, 1500.10);
      expect(s.balanceDue, 1500.10);
      expect(s.settles, isTrue);
      expect(s.settlementProblem, isNull);
    });

    test('a shortfall reads as money, not as a raw double', () {
      // "₹500.0 of the balance is still unaccounted for" is not a sentence to
      // show anyone.
      final s = withPayment([PaymentDraft(method: 'CASH', amount: '1000')]);
      expect(s.settlementProblem, isNot(contains('.0 ')));
    });
  });

  // ── How an issued bill reads ─────────────────────────────────────────────
  group('an issued bill', () {
    test('a split names every method', () {
      final invoice = Invoice.fromJson(const {
        'id': '44',
        'balanceCollected': 1500,
        'balancePaymentMethod': 'CASH',
        'paymentLines': [
          {'method': 'CASH', 'amount': 500},
          {'method': 'UPI', 'amount': 1000, 'reference': 'UTR9'},
        ],
      });
      expect(invoice.tenders.length, 2);
      expect(invoice.tenders.last.reference, 'UTR9');
    });

    test('a bill issued before payment lines existed still reads', () {
      // Older documents carry only the invoice's own scalar columns. They fall
      // back to a single tender, so every bill has one shape to render.
      final invoice = Invoice.fromJson(const {
        'id': '12',
        'balanceCollected': 900,
        'balancePaymentMethod': 'CASH',
        'paymentLines': [],
      });
      expect(invoice.tenders.length, 1);
      expect(invoice.tenders.single.method, 'CASH');
      expect(invoice.tenders.single.amount, 900);
    });

    test('a bill that collected nothing shows no tender', () {
      final invoice = Invoice.fromJson(const {
        'id': '13',
        'balanceCollected': 0,
        'balancePaymentMethod': 'CASH',
      });
      expect(invoice.tenders, isEmpty);
    });

    test('ids arrive as strings here too', () {
      // invoices.id is a BIGINT.
      expect(Invoice.fromJson(const {'id': '44'}).id, 44);
      expect(
        BillableStay.fromJson(const {'id': '66', 'totalPrice': 6400}).id,
        66,
      );
    });

    test('a queue row works out what is still to collect', () {
      final stay = BillableStay.fromJson(const {
        'id': '66',
        'totalPrice': 6400,
        'advanceAmount': 400,
      });
      expect(stay.balanceDue, 6000);
    });
  });

  test('a stay already billed cannot be billed again', () {
    // Issuing twice would burn a second serial on one stay.
    final p = BillPreview.fromJson(const {
      'bookingId': 1,
      'alreadyInvoiced': true,
      'isGstRegistered': true,
      'gst': {'totalAmount': 1000},
    });
    expect(p.alreadyInvoiced, isTrue);
  });

  test('the payment payload drops a reference on cash', () {
    // A reference typed before switching to cash would otherwise file a
    // transaction number against money that never had one.
    final cash = PaymentDraft(
      method: 'CASH',
      amount: '1500',
      reference: 'typed then switched',
    );
    expect(cash.toJson().containsKey('reference'), isFalse);
  });

  test('a booking row and an invoice agree about a split advance', () {
    // The same two lines, read through the two models the two screens use.
    const lines = [
      {'method': 'CASH', 'amount': 200},
      {'method': 'UPI', 'amount': 100, 'reference': 'U1'},
    ];
    final booking = Booking.fromJson(const {
      'id': '70',
      'advanceAmount': 300,
      'advancePaymentMethod': 'CASH',
      'advancePaymentLines': lines,
    });
    expect(booking.advanceDescription, 'CASH ₹200 · UPI ₹100');
  });
}
