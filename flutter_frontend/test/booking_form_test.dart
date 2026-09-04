import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/booking.dart';
import 'package:hotel_manager/domain/models/draft.dart';
import 'package:hotel_manager/domain/repository/booking_repo.dart';
import 'package:hotel_manager/domain/usecase/booking_usecase.dart';
import 'package:hotel_manager/presentation/view_models/booking_viewmodel.dart';

/// The rules behind the booking form, and the wire formats it has to hit.
///
/// A wrong format here is silent: the server accepts the request, prices the
/// stay at rack rate or drops a guest, and nothing anywhere says so.
void main() {
  // ── A negotiated total becomes a stored rate ──────────────────────────────
  //
  // Reception agrees a total — "call it 1,500 for the two nights" — and the
  // booking stores a nightly rate. Divided by the nights alone, never by the
  // count: an agreed figure is what the whole line costs, so three beds at an
  // agreed 100 is 100, not three times 33.33.
  group('a total typed at the desk', () {
    test('divides across the nights', () {
      expect(BookingViewModel.perNight('3000', 2), 1500);
      expect(BookingViewModel.perNight('1500', 1), 1500);
    });

    test('rounds to the paisa rather than trailing a float', () {
      expect(BookingViewModel.perNight('1000', 3), 333.33);
    });

    test('blank means the lodge’s own rate, not zero', () {
      // Null is what makes the server price at the category rate. Zero would
      // be ignored by the pricing engine and read as "free" by nobody.
      expect(BookingViewModel.perNight('', 2), isNull);
      expect(BookingViewModel.perNight('0', 2), isNull);
      expect(BookingViewModel.perNight('-50', 2), isNull);
      expect(BookingViewModel.perNight('abc', 2), isNull);
    });

    test('a zero-night stay does not divide by zero', () {
      expect(BookingViewModel.perNight('1500', 0), 1500);
    });
  });

  // ── A concession off the whole stay ───────────────────────────────────────
  //
  // The counterpart to the rule above, and deliberately not the same rule. An
  // agreed room total is a rate and is divided by the nights; a concession is
  // against the total those nights came to and is sent whole. Dividing it
  // would take a tenth off a ten-night stay.
  group('a concession typed at the desk', () {
    test('is sent whole, not per night', () {
      expect(BookingViewModel.wholeAmount('500'), 500);
      // The same figure regardless of how long the stay is — there is no
      // nights argument to pass, which is the point.
      expect(BookingViewModel.wholeAmount('500'), isNot(250));
    });

    test('keeps the paisa it was given', () {
      expect(BookingViewModel.wholeAmount('99.50'), 99.5);
    });

    test('blank means no concession, not a concession of nothing', () {
      // Null leaves discountAmount out of the request entirely. Zero would be
      // sent and normalised to "no concession" anyway, but only null says the
      // desk never touched the box.
      expect(BookingViewModel.wholeAmount(''), isNull);
      expect(BookingViewModel.wholeAmount('   '), isNull);
      expect(BookingViewModel.wholeAmount('0'), isNull);
      expect(BookingViewModel.wholeAmount('abc'), isNull);
    });

    test('a negative concession is not a surcharge', () {
      expect(BookingViewModel.wholeAmount('-200'), isNull);
    });
  });

  // ── What the advance adds up to ───────────────────────────────────────────
  group('a split advance', () {
    test('sums in paise, not as raw floats', () {
      // 600 + 900.10 is 1500.0999999999999 in binary floating point, and this
      // figure is posted as the amount taken.
      final lines = [
        PaymentDraft(method: 'CASH', amount: '600'),
        PaymentDraft(method: 'UPI', amount: '900.10', reference: 'UTR1'),
      ];
      expect(sumPayments(lines), 1500.10);
    });

    test('a UPI row without its transaction number is refused', () {
      expect(
        paymentLinesError([PaymentDraft(method: 'UPI', amount: '400')]),
        'Enter the transaction number for a UPI or card payment.',
      );
    });

    test('a cash row needs no reference', () {
      expect(
        paymentLinesError([PaymentDraft(method: 'CASH', amount: '400')]),
        isNull,
      );
    });

    test('a row with no method is refused', () {
      expect(
        paymentLinesError([PaymentDraft(amount: '400')]),
        'Choose how each part was paid.',
      );
    });

    test('the payload drops a reference on cash', () {
      // A reference typed before switching to cash would otherwise file a
      // transaction number against money that never had one.
      final cash = PaymentDraft(
        method: 'CASH',
        amount: '400',
        reference: 'typed then switched',
      );
      expect(cash.toJson().containsKey('reference'), isFalse);

      final upi = PaymentDraft(method: 'UPI', amount: '400', reference: 'U1');
      expect(upi.toJson()['reference'], 'U1');
    });
  });

  // ── The rest of the party ────────────────────────────────────────────────
  group('additional guests', () {
    test('optional fields are left out rather than sent empty', () {
      // bookingGuestSchema takes an enum for idProofType and a length-checked
      // string for the number. An empty string fails both; an absent key is
      // simply "not recorded".
      final bare = GuestDraft(name: 'Asha').toJson();
      expect(bare['name'], 'Asha');
      expect(bare.containsKey('idProofType'), isFalse);
      expect(bare.containsKey('idProofNumber'), isFalse);
      expect(bare.containsKey('phone'), isFalse);
      expect(bare['isChild'], isFalse);
    });

    test('an ID is carried when it was recorded', () {
      final withId = GuestDraft(
        name: 'Asha',
        idProofType: 'AADHAAR',
        idProofNumber: '1234 5678 9012',
        isChild: true,
      ).toJson();

      expect(withId['idProofType'], 'AADHAAR');
      expect(withId['idProofNumber'], '1234 5678 9012');
      expect(withId['isChild'], isTrue);
    });

    test('a nameless row is spotted before it is sent', () {
      expect(GuestDraft().isEmpty, isTrue);
      expect(GuestDraft(name: '  ').isEmpty, isTrue);
      expect(GuestDraft(name: 'Asha').isEmpty, isFalse);
    });

    test('every ID type offered is one the server accepts', () {
      // Mirrors ID_PROOF_TYPES in bookings.schema.js. Anything else is a 400.
      expect(kIdProofTypes.keys.toSet(), {
        'AADHAAR',
        'PAN',
        'PASSPORT',
        'DRIVING_LICENSE',
        'VOTER_ID',
        'OTHER',
      });
      expect(kPaymentMethods.keys.toSet(), {'CASH', 'UPI', 'CARD'});
    });
  });

  // ── The register filter ──────────────────────────────────────────────────
  //
  // GET /bookings takes a date range and nothing else. The status the desk
  // picks is applied to what came back, not sent — a `status` query parameter
  // was silently ignored, so every chip showed the same list.
  group('the register filter', () {
    BookingState withRows() => BookingState(
      register: AsyncValue.data([
        const Booking(id: 1, status: 'BOOKED'),
        const Booking(id: 2, status: 'CHECKED_IN'),
        const Booking(id: 3, status: 'CHECKED_OUT'),
        const Booking(id: 4, status: 'BOOKED'),
      ]),
    );

    test('ALL shows everything', () {
      expect(withRows().visibleRegister.length, 4);
    });

    test('a status shows only its own', () {
      final booked = withRows().copyWith(statusFilter: 'BOOKED');
      expect(booked.visibleRegister.map((b) => b.id), [1, 4]);

      final stayed = withRows().copyWith(statusFilter: 'CHECKED_OUT');
      expect(stayed.visibleRegister.map((b) => b.id), [3]);
    });

    test('a filter matching nothing is empty, not everything', () {
      final none = withRows().copyWith(statusFilter: 'CANCELLED');
      expect(none.visibleRegister, isEmpty);
    });

    test('the filter survives a reload', () {
      // reset() clears the take-a-booking flow and keeps the register and the
      // chip the desk chose — otherwise every save would snap it back to All.
      final vm = BookingViewModel(BookingUsecase(_UnusedRepo()));
      vm.setStatusFilter('CHECKED_IN');
      vm.reset();
      expect(vm.state.statusFilter, 'CHECKED_IN');
    });
  });

  // ── Reservation or walk-in ───────────────────────────────────────────────
  //
  // Not a question the desk is asked: the dates answer it. A stay whose first
  // night is tonight is somebody standing at the counter, and it is checked in
  // as soon as it is saved. Only a later start is a reservation.
  group('what kind of stay this is', () {
    DateTime day(int offset) {
      final now = DateTime.now();
      return DateTime(now.year, now.month, now.day).add(Duration(days: offset));
    }

    BookingState on(int startOffset) => BookingState(
      checkIn: day(startOffset),
      checkOut: day(startOffset + 1),
    );

    test('starting today is a walk-in', () {
      expect(on(0).bookingType, 'WALK_IN');
      expect(on(0).isWalkIn, isTrue);
      expect(on(0).isFutureCheckIn, isFalse);
    });

    test('starting tomorrow is a reservation', () {
      expect(on(1).bookingType, 'RESERVATION');
      expect(on(1).isWalkIn, isFalse);
      expect(on(1).isFutureCheckIn, isTrue);
    });

    test('a stay entered after the fact is a walk-in, not a reservation', () {
      // A stay taken on paper over the weekend is recorded against the nights
      // it actually happened on. It cannot be waiting to arrive.
      expect(on(-3).bookingType, 'WALK_IN');
    });

    test('the boundary is the day, not the hour', () {
      // Booked at 9pm for tonight is still a walk-in; comparing instants
      // rather than dates would make it a reservation for a night already
      // under way.
      final now = DateTime.now();
      final lateToday = DateTime(now.year, now.month, now.day, 23, 59);
      final state = BookingState(
        checkIn: lateToday,
        checkOut: lateToday.add(const Duration(days: 1)),
      );
      expect(state.isFutureCheckIn, isFalse);
      expect(state.bookingType, 'WALK_IN');
    });

    test('no dates yet is not a future check-in', () {
      expect(const BookingState().isFutureCheckIn, isFalse);
    });
  });
}

/// The filter tests never reach the network — that is the point of them.
class _UnusedRepo implements BookingRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('the filter is applied without the server');
}
