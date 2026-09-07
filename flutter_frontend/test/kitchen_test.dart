import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/food_order.dart';
import 'package:hotel_manager/domain/models/me.dart';
import 'package:hotel_manager/domain/models/menu.dart';
import 'package:hotel_manager/domain/models/session.dart';
import 'package:hotel_manager/domain/repository/auth_repo.dart';
import 'package:hotel_manager/domain/repository/orders_repo.dart';
import 'package:hotel_manager/domain/usecase/auth_usecase.dart';
import 'package:hotel_manager/domain/usecase/orders_usecase.dart';
import 'package:hotel_manager/presentation/providers/usecase_provider.dart';
import 'package:hotel_manager/screens/shell/dashboard_shell.dart';
import 'package:hotel_manager/screens/theme.dart';

/// The kitchen could not use this app at all.
///
/// The seeded KITCHEN role carries exactly one permission, `orders.manage`
/// (backend/migrations/006_roles.sql), which maps to the Food section — and
/// that section was a placeholder. A cook signing in got one tab saying the
/// feature was not on the phone yet, and nothing else. These tests pin the
/// fix: a kitchen login lands on a real queue.

class _FakeAuth implements AuthRepository {
  final Me answer;
  _FakeAuth(this.answer);

  @override
  Future<Me> me() async => answer;

  @override
  Future<Session> login(Credentials credentials) async =>
      const Session(token: 't', role: 'KITCHEN');
}

class _FakeOrders implements OrdersRepository {
  final List<FoodOrder> live;

  /// Every status change the screen asked for, so a test can assert that the
  /// button sent what it said it would.
  final List<String> sent = [];

  _FakeOrders(this.live);

  @override
  Future<List<FoodOrder>> queue() async => live;

  @override
  Future<List<FoodOrder>> orders({String? date, String? status}) async =>
      const [];

  @override
  Future<FoodOrder> setStatus(
    int id,
    String status, {
    String? cancelReason,
  }) async {
    sent.add(status);
    return FoodOrder(id: id, status: status);
  }

  @override
  Future<FoodOrder> setItemReady(int id, int itemId, bool ready) async =>
      FoodOrder(id: id);

  @override
  Future<FoodOrder> createCounterOrder(Map<String, dynamic> body) async =>
      const FoodOrder(id: 1, orderNumber: 7);

  @override
  Future<List<MenuSection>> menu() async => const [];

  @override
  Future<List<DiningTable>> tables() async => const [];
}

/// A cook: one permission, at a property that serves food.
Me _kitchen() => Me.fromJson(const {
  'user': {
    'id': '9',
    'name': 'Devidas Naik',
    'role': 'KITCHEN',
    'roleName': 'Kitchen',
    'permissions': ['orders.manage'],
  },
  'lodge': {
    'id': '1',
    'name': 'Malvan Katta',
    'hasRooms': false,
    'servesFood': true,
    'foodTableService': true,
  },
});

Widget _app(Me me, _FakeOrders orders) => ProviderScope(
  overrides: [
    authUsecaseProvider.overrideWithValue(AuthUsecase(_FakeAuth(me))),
    ordersUsecaseProvider.overrideWithValue(OrdersUsecase(orders)),
  ],
  child: MaterialApp(theme: AppTheme.light, home: const DashboardShell()),
);

FoodOrder _ticket({
  int id = 1,
  int number = 12,
  String status = 'PENDING',
  List<String> next = const ['QUEUED', 'CANCELLED'],
}) => FoodOrder(
  id: id,
  orderNumber: number,
  status: status,
  tableLabel: 'Table 4',
  subtotal: 260,
  nextStatuses: next,
  items: const [
    FoodOrderItem(id: 1, name: 'Solkadhi', quantity: 2, lineTotal: 120),
    FoodOrderItem(id: 2, name: 'Fish thali', quantity: 1, lineTotal: 140),
  ],
);

void main() {
  testWidgets('a kitchen login lands on a real queue, not a placeholder', (
    tester,
  ) async {
    await tester.pumpWidget(_app(_kitchen(), _FakeOrders([_ticket()])));
    await tester.pumpAndSettle();

    // The regression this whole phase exists for.
    expect(find.textContaining('not on the phone yet'), findsNothing);

    // The ticket is drawn: its number, where it goes, and what is on it.
    expect(find.textContaining('#12'), findsOneWidget);
    expect(find.text('Solkadhi'), findsOneWidget);
    expect(find.text('Fish thali'), findsOneWidget);
  });

  testWidgets('the kitchen sees only its own section', (tester) async {
    await tester.pumpWidget(_app(_kitchen(), _FakeOrders([_ticket()])));
    await tester.pumpAndSettle();

    // One permission, one tab. Bookings and Billing must not appear for a
    // login that cannot reach them.
    expect(find.text('Food'), findsOneWidget);
    expect(find.text('Bookings'), findsNothing);
    expect(find.text('Billing'), findsNothing);
  });

  testWidgets('action buttons come from the server, not from the phone', (
    tester,
  ) async {
    final orders = _FakeOrders([
      _ticket(status: 'PREPARING', next: const ['READY', 'CANCELLED']),
    ]);
    await tester.pumpWidget(_app(_kitchen(), orders));
    await tester.pumpAndSettle();

    // Exactly the transitions nextStatuses offered — no Accept, because the
    // server did not offer QUEUED from PREPARING.
    expect(find.text('Ready'), findsOneWidget);
    expect(find.text('Cancel'), findsOneWidget);
    expect(find.text('Accept'), findsNothing);
    expect(find.text('Start cooking'), findsNothing);

    await tester.tap(find.text('Ready'));
    await tester.pumpAndSettle();
    expect(orders.sent, ['READY']);
  });

  testWidgets('an empty queue says so rather than going blank', (tester) async {
    await tester.pumpWidget(_app(_kitchen(), _FakeOrders(const [])));
    await tester.pumpAndSettle();

    expect(find.text('Nothing is cooking.'), findsOneWidget);
    expect(find.text('Take an order'), findsOneWidget);
  });

  group('a ticket', () {
    test('names where it goes rather than a source code', () {
      expect(_ticket().target, 'Table 4');
      expect(
        const FoodOrder(id: 1, roomNumber: '202').target,
        'Room 202',
      );
      // Nothing attached is a counter order, not an unknown one.
      expect(const FoodOrder(id: 1).target, 'Counter');
    });

    test('reads its status in the kitchen’s words', () {
      expect(_ticket().statusLabel, 'Needs accepting');
      expect(
        const FoodOrder(id: 1, status: 'PREPARING').statusLabel,
        'Preparing',
      );
    });

    test('a missing timestamp is unknown, not zero', () {
      // "just now" and "not known" are different things on a kitchen screen.
      expect(const FoodOrder(id: 1).waitingFor(DateTime.now()), isNull);
    });

    test('waiting time never runs backwards', () {
      // A phone whose clock is behind the server's would otherwise show a
      // negative wait, which reads as nonsense on the card.
      final future = DateTime.now().add(const Duration(minutes: 5));
      final order = FoodOrder(id: 1, placedAt: future.toIso8601String());
      expect(order.waitingFor(DateTime.now()), Duration.zero);
    });
  });

  group('a counter order line', () {
    test('leaves portionId out entirely for a dish with no sizes', () {
      final line = OrderLineDraft(
        item: const MenuItem(id: 5, name: 'Solkadhi', price: 60),
        quantity: 2,
      );
      // Absent, not null: the schema treats a missing key as "no size" and
      // refuses a portion that belongs to another dish.
      expect(line.toJson().containsKey('portionId'), isFalse);
      expect(line.toJson()['itemId'], 5);
      expect(line.lineTotal, 120);
    });

    test('takes its price from the chosen size, not the dish', () {
      const half = MenuPortion(id: 9, label: 'Half', price: 90);
      final line = OrderLineDraft(
        item: const MenuItem(
          id: 5,
          name: 'Fish thali',
          price: 0,
          portions: [half],
        ),
        portion: half,
        quantity: 2,
      );
      expect(line.toJson()['portionId'], 9);
      expect(line.lineTotal, 180);
    });

    test('a dish that is off today cannot be ordered', () {
      const off = MenuItem(id: 5, name: 'Crab', isAvailable: false);
      expect(off.orderable, isFalse);
      // Still shown, so the desk can say it is off rather than that it does
      // not exist.
      const retired = MenuItem(id: 6, name: 'Prawns', isActive: false);
      expect(retired.orderable, isFalse);
    });
  });
}
