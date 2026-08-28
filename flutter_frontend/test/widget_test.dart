import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/booking.dart';
import 'package:hotel_manager/domain/models/me.dart';
import 'package:hotel_manager/domain/models/quote.dart';
import 'package:hotel_manager/domain/models/room.dart';
import 'package:hotel_manager/domain/models/session.dart';
import 'package:hotel_manager/screens/shell/feature.dart';

/// The rules the phone shares with the web front desk. Tested here because
/// getting either wrong is silent: a tab that should not be there, or an
/// advance that reads as a method the guest never used.
void main() {
  // ── What a login may reach ────────────────────────────────────────────────
  //
  // Two gates, not one. A permission says what this login may do; a capability
  // says what the property actually has. An owner of a restaurant holds every
  // permission there is and still must not be shown the rooms sections.
  group('sections a login may reach', () {
    Me me({
      required List<String> permissions,
      bool hasRooms = true,
      bool servesFood = true,
    }) => Me(
      user: MeUser(id: 1, name: 'A', role: 'OWNER', permissions: permissions),
      lodge: Lodge(
        id: 1,
        name: 'Lodge',
        hasRooms: hasRooms,
        servesFood: servesFood,
      ),
    );

    test('a permission alone is not enough without the capability', () {
      final bookings = kFeatures.firstWhere((f) => f.key == 'bookings');
      final restaurantOwner = me(
        permissions: ['bookings.manage'],
        hasRooms: false,
      );
      expect(
        bookings.availableTo(restaurantOwner),
        isFalse,
        reason: 'a property with no rooms must not offer to book one',
      );
    });

    test('a capability alone is not enough without the permission', () {
      final bookings = kFeatures.firstWhere((f) => f.key == 'bookings');
      expect(bookings.availableTo(me(permissions: const [])), isFalse);
    });

    test('both together open the section', () {
      final bookings = kFeatures.firstWhere((f) => f.key == 'bookings');
      expect(bookings.availableTo(me(permissions: ['bookings.manage'])), isTrue);
    });

    test('a section with no capability gate needs only the permission', () {
      final staff = kFeatures.firstWhere((f) => f.key == 'staff');
      expect(
        staff.availableTo(
          me(permissions: ['staff.manage'], hasRooms: false, servesFood: false),
        ),
        isTrue,
        reason: 'staff and roles exist whatever the property sells',
      );
    });

    test('the bar never shows more than the primary tabs plus More', () {
      final everything = me(
        permissions: kFeatures.map((f) => f.permission).toList(),
      );
      final visible = kFeatures.where((f) => f.availableTo(everything));
      expect(
        visible.length,
        greaterThan(kPrimaryTabs),
        reason: 'if it ever fits, the More sheet is dead weight',
      );
    });
  });

  // ── How an advance reads ──────────────────────────────────────────────────
  group('advance description', () {
    Booking withLines(List<PaymentLine>? lines, {String? scalar}) => Booking(
      id: 1,
      advanceAmount: 300,
      advancePaymentMethod: scalar,
      advancePaymentLines: lines,
    );

    test('falls back to the single method when there are no lines', () {
      // A list row carries no lines, only the scalar. It must still say
      // something rather than nothing.
      expect(withLines(null, scalar: 'CASH').advanceDescription, 'CASH');
    });

    test('one line prints as its own name', () {
      expect(
        withLines([
          const PaymentLine(method: 'CASH', amount: 300),
        ], scalar: 'CASH').advanceDescription,
        'CASH',
      );
    });

    test('a split names every method, not just the first', () {
      // The bug this guards: the scalar column holds only the first tender, so
      // ₹200 cash + ₹100 UPI used to read as "CASH" — which the guest who paid
      // it can see is wrong.
      expect(
        withLines([
          const PaymentLine(method: 'CASH', amount: 200),
          const PaymentLine(method: 'UPI', amount: 100, reference: 'UTR1'),
        ], scalar: 'CASH').advanceDescription,
        'CASH ₹200 · UPI ₹100',
      );
    });
  });

  // ── Money the server owns ─────────────────────────────────────────────────
  test('a quote is read, never recomputed', () {
    // totalPrice is taken from the server rather than derived from the lines.
    // The two can legitimately differ: a discount comes off before tax and the
    // total rounds to the rupee, so adding the lines up here would disagree
    // with the bill that is eventually issued.
    final quote = Quote.fromJson(const {
      'charges': [
        {'label': 'Deluxe ₹1,300', 'amount': 1300, 'isBase': true},
        {'label': 'AC/Heater', 'amount': 200, 'chargeId': 1},
      ],
      'nights': [
        {'date': '2026-09-01', 'total': 1500},
      ],
      'grossTotal': 1500,
      'discountAmount': 100,
      'totalPrice': 1400,
    });

    expect(quote.totalPrice, 1400);
    expect(quote.charges.where((c) => c.isBase).length, 1);
    expect(quote.charges.firstWhere((c) => c.isExtra).chargeId, 1);
    expect(quote.nightCount, 1);
  });

  test('a booking decodes what a list row leaves out', () {
    // The register and the detail endpoint answer with different amounts of
    // the same shape, and both come through this one class.
    final row = Booking.fromJson(const {
      'id': 7,
      'guestName': 'Sagar',
      'totalPrice': 1800,
      'advanceAmount': 300,
    });

    expect(row.roomNumber, isNull);
    expect(row.advancePaymentLines, isNull);
    expect(row.balanceDue, 1500);
  });

  // ── Types as the server actually sends them ───────────────────────────────
  //
  // SQL Server through tedious returns BIGINT columns as **strings** — a bigint
  // does not fit a JavaScript number, so the driver will not narrow it. INT and
  // DECIMAL come back as numbers. So `{"id": "46", "numGuests": 2}` is normal
  // and correct, and a cast like `as num` is right for one field and throws on
  // the other.
  //
  // It threw *after* a 200: a login that had genuinely succeeded surfaced as
  // "something went wrong", because the failure was in reading the reply rather
  // than in making the call. These pin the real shapes.
  group('ids arrive as strings', () {
    test('a login parses the payload the server actually sent', () {
      // Copied verbatim from the device log, lodgeId included.
      final session = Session.fromJson(const {
        'token': 'eyJhbGciOiJIUzI1NiJ9.abc.def',
        'role': 'OWNER',
        'name': 'Suresh Naik',
        'lodgeId': '1',
        'mustResetPassword': false,
      });

      expect(session.lodgeId, 1, reason: 'lodges.id is a BIGINT: "1", not 1');
      expect(session.role, 'OWNER');
      expect(session.mustResetPassword, isFalse);
    });

    test('a numeric lodgeId still works', () {
      // Nothing here should depend on which of the two it was.
      expect(
        Session.fromJson(const {
          'token': 't',
          'role': 'OWNER',
          'lodgeId': 1,
        }).lodgeId,
        1,
      );
    });

    test('/me mixes both types in one object', () {
      final me = Me.fromJson(const {
        'user': {
          'id': '46', // BIGINT
          'name': 'Suresh Naik',
          'role': 'OWNER',
          'permissions': ['bookings.manage'],
        },
        'lodge': {'id': '1', 'name': 'Sea View', 'hasRooms': true},
      });

      expect(me.user.id, 46);
      expect(me.lodge.id, 1);
      expect(me.user.can('bookings.manage'), isTrue);
    });

    test('a booking mixes BIGINT ids with INT counts and DECIMAL money', () {
      final booking = Booking.fromJson(const {
        'id': '73', // BIGINT
        'roomId': '4', // BIGINT
        'numGuests': 2, // INT
        'totalPrice': 1800, // DECIMAL
        'advanceAmount': 300,
        'guestPhone': 9421072971, // sometimes a number
      });

      expect(booking.id, 73);
      expect(booking.roomId, 4);
      expect(booking.numGuests, 2);
      expect(booking.balanceDue, 1500);
      expect(booking.guestPhone, '9421072971');
    });

    test('a room and its extras carry BIGINT ids too', () {
      final rooms = AvailableRooms.fromJson(const {
        'rooms': [
          {
            'id': '12',
            'roomNumber': '101',
            'categoryName': 'Deluxe',
            'categoryBasePrice': 1300,
            'switchableCharges': [
              {'id': '1', 'name': 'AC/Heater', 'chargePerNight': 200},
            ],
          },
        ],
      });

      expect(rooms.rooms.single.id, 12);
      expect(rooms.rooms.single.switchableCharges.single.id, 1);
    });

    test('a garbled number is null rather than a crash', () {
      // Better a field that renders empty than a screen that will not open.
      expect(
        Session.fromJson(const {
          'token': 't',
          'role': 'OWNER',
          'lodgeId': 'not-a-number',
        }).lodgeId,
        isNull,
      );
    });
  });
}
