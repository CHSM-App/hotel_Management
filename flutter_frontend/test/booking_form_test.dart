import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/charge_selections.dart';
import 'package:hotel_manager/domain/models/draft.dart';
import 'package:hotel_manager/domain/models/extra_room.dart';
import 'package:hotel_manager/domain/models/multi_room_logic.dart';
import 'package:hotel_manager/domain/models/quote.dart';
import 'package:hotel_manager/domain/models/room.dart';
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

    test('a UPI row without its transaction number is accepted', () {
      // Offered, never demanded — the number is often not to hand at the
      // moment of payment, so it stays optional on UPI and card alike.
      expect(
        paymentLinesError([PaymentDraft(method: 'UPI', amount: '400')]),
        isNull,
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

  // ── Resetting the take-a-booking flow ────────────────────────────────────
  //
  // reset() clears everything the form gathered so far, but the tape chart
  // behind it is a different screen's data — a save should not throw away
  // which nights the chart was showing.
  group('resetting after a save', () {
    test('keeps the chart window, not the dates just booked', () {
      final vm = BookingViewModel(BookingUsecase(_UnusedRepo()));
      final chartFrom = vm.state.chartFrom;
      final chartTo = vm.state.chartTo;

      vm.state = vm.state.copyWith(
        checkIn: DateTime(2026, 1, 1),
        checkOut: DateTime(2026, 1, 2),
      );
      vm.reset();

      expect(vm.state.checkIn, isNull);
      expect(vm.state.chartFrom, chartFrom);
      expect(vm.state.chartTo, chartTo);
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
      expect(BookingState().isFutureCheckIn, isFalse);
    });
  });

  // ── Multi-room bookings ───────────────────────────────────────────────────
  Room room(int id, {String number = '', bool dormitory = false}) => Room(
    id: id,
    roomNumber: number.isEmpty ? '$id' : number,
    categoryName: 'Deluxe',
    categoryBasePrice: 1000,
    isDormitory: dormitory,
  );

  group('bookingWindow', () {
    test('takes the earliest checkIn and latest checkOut across rooms', () {
      final state = BookingState(
        checkIn: DateTime(2026, 1, 5),
        checkOut: DateTime(2026, 1, 6),
        room: room(1),
        multiRoomMode: true,
        multiRoomDifferentDates: true,
        extraRooms: [
          ExtraRoomDraft(
            room: room(2),
            checkIn: DateTime(2026, 1, 3),
            checkOut: DateTime(2026, 1, 8),
          ),
        ],
      );
      final window = MultiRoomLogic.bookingWindow(state);
      expect(window, (DateTime(2026, 1, 3), DateTime(2026, 1, 8)));
    });

    test('falls back to room 1 dates when no extra room has its own', () {
      final state = BookingState(
        checkIn: DateTime(2026, 1, 5),
        checkOut: DateTime(2026, 1, 6),
        room: room(1),
        multiRoomMode: true,
        extraRooms: [ExtraRoomDraft(room: room(2))],
      );
      expect(
        MultiRoomLogic.bookingWindow(state),
        (DateTime(2026, 1, 5), DateTime(2026, 1, 6)),
      );
    });
  });

  group('toggleRoomChoice', () {
    test('first tick fills room 1', () {
      final next = MultiRoomLogic.toggleRoomChoice(BookingState(), room(1));
      expect(next.room?.id, 1);
      expect(next.extraRooms, isEmpty);
    });

    test('second tick becomes an extra room', () {
      var state = MultiRoomLogic.toggleRoomChoice(BookingState(), room(1));
      state = MultiRoomLogic.toggleRoomChoice(state, room(2));
      expect(state.room?.id, 1);
      expect(state.extraRooms.map((r) => r.room?.id), [2]);
    });

    test('un-ticking room 1 promotes the first extra into its slot', () {
      var state = MultiRoomLogic.toggleRoomChoice(BookingState(), room(1));
      state = MultiRoomLogic.toggleRoomChoice(state, room(2));
      state = MultiRoomLogic.toggleRoomChoice(state, room(1));
      expect(state.room?.id, 2);
      expect(state.extraRooms, isEmpty);
    });

    test('un-ticking an extra room removes just that slot', () {
      var state = MultiRoomLogic.toggleRoomChoice(BookingState(), room(1));
      state = MultiRoomLogic.toggleRoomChoice(state, room(2));
      state = MultiRoomLogic.toggleRoomChoice(state, room(3));
      state = MultiRoomLogic.toggleRoomChoice(state, room(2));
      expect(state.room?.id, 1);
      expect(state.extraRooms.map((r) => r.room?.id), [3]);
    });
  });

  group('roomsPayload', () {
    test('includes bookingRoomId only when editing an existing room', () {
      final state = BookingState(
        checkIn: DateTime(2026, 1, 5),
        checkOut: DateTime(2026, 1, 6),
        room: room(1),
        multiRoomMode: true,
        extraRooms: [
          ExtraRoomDraft(bookingRoomId: 55, room: room(2)),
        ],
      );
      final payload = MultiRoomLogic.roomsPayload(state);
      expect(payload[0].containsKey('bookingRoomId'), isFalse);
      expect(payload[1]['bookingRoomId'], 55);
    });

    test(
      'omits bedIds/checkInDate/checkOutDate for a non-dormitory room in same-dates mode',
      () {
        final state = BookingState(
          checkIn: DateTime(2026, 1, 5),
          checkOut: DateTime(2026, 1, 6),
          room: room(1),
          multiRoomMode: true,
          extraRooms: [ExtraRoomDraft(room: room(2))],
        );
        final entry = MultiRoomLogic.roomsPayload(state)[1];
        expect(entry.containsKey('bedIds'), isFalse);
        expect(entry.containsKey('checkInDate'), isFalse);
        expect(entry.containsKey('checkOutDate'), isFalse);
      },
    );

    test('includes each room\'s own switchableCharges array', () {
      final state = BookingState(
        checkIn: DateTime(2026, 1, 5),
        checkOut: DateTime(2026, 1, 6),
        room: room(1),
        multiRoomMode: true,
        extraRooms: [
          ExtraRoomDraft(
            room: room(2),
            extras: {7: ExtraDraft(quantity: 2)},
          ),
        ],
      );
      final entry = MultiRoomLogic.roomsPayload(state)[1];
      expect(entry['switchableCharges'], [
        {'id': 7, 'quantity': 2},
      ]);
    });
  });

  group('combineQuote', () {
    test(
      'flattens per-room charge lines with "Room {n} · {label}" prefix on extras',
      () {
        final response = MultiRoomQuote(
          rooms: [
            RoomQuote(
              roomId: 1,
              checkInDate: '2026-01-05',
              checkOutDate: '2026-01-06',
              charges: [QuoteLine(label: 'Room rate', amount: 1000, isBase: true)],
            ),
            RoomQuote(
              roomId: 2,
              checkInDate: '2026-01-05',
              checkOutDate: '2026-01-06',
              charges: [QuoteLine(label: 'Room rate', amount: 1200, isBase: true)],
            ),
          ],
          grossTotal: 2200,
          totalPrice: 2200,
        );
        final quote = MultiRoomLogic.combineQuote(response, ['101', '102']);
        expect(quote.charges[0].label, 'Room rate');
        expect(quote.charges[1].label, 'Room 102 · Room rate');
      },
    );

    test(
      'sums grossTotal/discountAmount/totalPrice from the top-level response, not by re-summing rooms',
      () {
        final response = MultiRoomQuote(
          rooms: [
            RoomQuote(
              roomId: 1,
              checkInDate: '2026-01-05',
              checkOutDate: '2026-01-06',
              grossTotal: 1000,
              totalPrice: 900,
            ),
          ],
          grossTotal: 5000,
          discountAmount: 300,
          totalPrice: 4700,
        );
        final quote = MultiRoomLogic.combineQuote(response, ['101']);
        expect(quote.grossTotal, 5000);
        expect(quote.discountAmount, 300);
        expect(quote.totalPrice, 4700);
      },
    );
  });

  group('ChargeSelections', () {
    test('sameCharge compares ids as numbers regardless of source type', () {
      expect(ChargeSelections.sameCharge(7, 7), isTrue);
      expect(ChargeSelections.sameCharge(7, 8), isFalse);
    });

    test('chargesParam serializes id:qty@price, omitting @price when nothing agreed', () {
      final extras = {
        7: ExtraDraft(quantity: 3),
        8: ExtraDraft(quantity: 1, agreedTotal: '250'),
      };
      final param = ChargeSelections.chargesParam(extras, 1);
      expect(param, '7:3,8:1@250.0');
    });

    test(
      'chargesPayload matches the shape BookingViewModel already built for single-room bookings',
      () {
        // Characterization test guarding the chargeIdsParam()/_extrasJson()
        // refactor onto this shared module — same wire format as before.
        final extras = {7: ExtraDraft(quantity: 2, agreedTotal: '500')};
        expect(ChargeSelections.chargesPayload(extras, 2), [
          {'id': 7, 'quantity': 2, 'agreedAmount': 250},
        ]);
      },
    );
  });
}

/// The filter tests never reach the network — that is the point of them.
class _UnusedRepo implements BookingRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('the filter is applied without the server');
}
