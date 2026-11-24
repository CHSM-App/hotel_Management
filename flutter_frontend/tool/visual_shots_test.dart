// Throwaway visual harness (not part of the suite): renders the shell with the
// Customers section at several window sizes into PNGs. Run with
//   flutter test tool/visual_shots_test.dart --dart-define=SHOTS_DIR=<dir>
// Reads SHOTS_DIR (output folder) and optional ONLY (substring of a size name).
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/core/offline/outbox_status.dart';
import 'package:hotel_manager/domain/models/customer.dart';
import 'package:hotel_manager/domain/models/asset.dart';
import 'package:hotel_manager/domain/models/booking.dart';
import 'package:hotel_manager/domain/models/tape_chart.dart';
import 'package:hotel_manager/domain/models/draft.dart';
import 'package:hotel_manager/domain/models/staff.dart';
import 'package:hotel_manager/domain/repository/assets_repo.dart';
import 'package:hotel_manager/domain/repository/booking_repo.dart';
import 'package:hotel_manager/domain/repository/staff_repo.dart';
import 'package:hotel_manager/domain/usecase/assets_usecase.dart';
import 'package:hotel_manager/domain/usecase/booking_usecase.dart';
import 'package:hotel_manager/domain/usecase/staff_usecase.dart';
import 'package:hotel_manager/domain/models/bar.dart';
import 'package:hotel_manager/domain/models/housekeeping.dart';
import 'package:hotel_manager/domain/models/lodge_service.dart';
import 'package:hotel_manager/domain/repository/bar_repo.dart';
import 'package:hotel_manager/domain/repository/housekeeping_repo.dart';
import 'package:hotel_manager/domain/repository/lodge_services_repo.dart';
import 'package:hotel_manager/domain/usecase/bar_usecase.dart';
import 'package:hotel_manager/domain/usecase/housekeeping_usecase.dart';
import 'package:hotel_manager/domain/usecase/lodge_services_usecase.dart';
import 'package:hotel_manager/domain/models/event_booking.dart';
import 'package:hotel_manager/domain/repository/events_repo.dart';
import 'package:hotel_manager/domain/usecase/events_usecase.dart';
import 'package:hotel_manager/domain/models/enquiry.dart';
import 'package:hotel_manager/domain/models/expense.dart';
import 'package:hotel_manager/domain/models/income.dart';
import 'package:hotel_manager/domain/repository/enquiries_repo.dart';
import 'package:hotel_manager/domain/repository/income_repo.dart';
import 'package:hotel_manager/domain/usecase/enquiries_usecase.dart';
import 'package:hotel_manager/domain/usecase/income_usecase.dart';
import 'package:hotel_manager/domain/repository/expenses_repo.dart';
import 'package:hotel_manager/domain/usecase/expenses_usecase.dart';
import 'package:hotel_manager/domain/models/me.dart';
import 'package:hotel_manager/domain/repository/auth_repo.dart';
import 'package:hotel_manager/domain/repository/customers_repo.dart';
import 'package:hotel_manager/domain/usecase/auth_usecase.dart';
import 'package:hotel_manager/domain/usecase/customers_usecase.dart';
import 'package:hotel_manager/presentation/providers/network_provider.dart';
import 'package:hotel_manager/presentation/providers/usecase_provider.dart';
import 'package:hotel_manager/core/network/dio_provider.dart';
import 'package:hotel_manager/data/api/api_service.dart';
import 'package:hotel_manager/presentation/providers/view_model_provider.dart';
import 'package:hotel_manager/screens/assets/asset_detail_screen.dart';
import 'package:hotel_manager/screens/laundry/linen_item_form_screen.dart';
import 'package:hotel_manager/screens/laundry/linen_send_screen.dart';
import 'package:hotel_manager/screens/login_screen.dart';
import 'package:hotel_manager/screens/printing/printer_settings_screen.dart';
import 'package:hotel_manager/screens/profile/profile_screen.dart';
import 'package:hotel_manager/screens/profile/whatsapp_settings_screen.dart';
import 'package:hotel_manager/screens/shell/dashboard_shell.dart';
import 'package:hotel_manager/screens/theme.dart';
import 'package:hotel_manager/widgets/neu.dart';

const _dir = String.fromEnvironment('SHOTS_DIR');
// Which section to open: customers (default), expenses, or a standalone
// screen: login | profile | whatsapp | printer.
const _section = String.fromEnvironment('SECTION', defaultValue: 'customers');

class _Auth implements AuthRepository {
  @override
  Future<Me> me() async => Me.fromJson(const {
    'user': {
      'id': '46',
      'name': 'Suresh Naik',
      'role': 'OWNER',
      'roleName': 'Owner',
      'permissions': ['rooms.manage', 'bookings.manage', 'billing.manage', 'guests.view', 'reports.view', 'staff.manage', 'customers.manage', 'enquiries.manage', 'expenses.manage', 'income.manage', 'assets.manage', 'housekeeping.manage', 'rooms.manage', 'bar.take', 'bar.bill', 'events.manage'],
    },
    'lodge': {'id': '1', 'name': 'Anand Executive Home Stay', 'hasRooms': true, 'servesFood': false, 'hasExpenses': true, 'hasEvents': true, 'hasAssets': true, 'hasHousekeeping': true, 'hasOtherServices': true, 'hasBar': true},
  });
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Expenses implements ExpensesRepository {
  @override
  Future<List<Expense>> expenses({
    int? categoryId,
    int? vendorId,
    int? assetId,
    int? recurringTemplateId,
    String? from,
    String? to,
  }) async => [
    for (var i = 0; i < 14; i++)
      Expense.fromJson({
        'id': i + 1,
        'categoryName': ['Electricity', 'Repairs', 'Groceries', 'Salaries'][i % 4],
        'vendorName': i.isEven ? 'Konkan Supplies' : null,
        'title': 'Bill #${1000 + i}',
        'amount': 1800 + i * 450,
        'paymentMethod': 'UPI',
        'paymentStatus': i % 3 == 0 ? 'PARTIAL' : 'PAID',
        'amountPaid': 1800 + i * 450 - (i % 3 == 0 ? 500 : 0),
        'expenseDate': '2026-08-${10 + i}',
        'createdAt': '2026-08-${10 + i}',
      }),
  ];
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Api implements ApiService {
  @override
  Future<Map<String, dynamic>> mySettings() async => {
    for (final k in ['waAutoBooking', 'waAutoWalkin', 'waAutoCancel', 'waAutoBill', 'waAutoReceipt'])
      k: true,
  };
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

/// Loads /me before showing a screen that reads it from the auth state.
class _Boot extends ConsumerStatefulWidget {
  final Widget child;
  const _Boot(this.child);
  @override
  ConsumerState<_Boot> createState() => _BootState();
}

class _BootState extends ConsumerState<_Boot> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(authViewModelProvider.notifier).loadMe());
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

Widget _home() => switch (_section) {
  'login' => const LoginScreen(),
  'profile' => const _Boot(ProfileScreen()),
  'whatsapp' => const WhatsAppSettingsScreen(),
  'assetdetail' => const AssetDetailScreen(assetId: 1),
  'linenitem' => const LinenItemFormScreen(),
  'linensend' => const LinenSendScreen(),
  'printer' => const PrinterSettingsScreen(),
  _ => const DashboardShell(),
};

bool get _isShell => const ['customers', 'expenses', 'income', 'enquiries', 'assets', 'staff', 'register', 'housekeeping', 'services', 'bar', 'eventregister', 'tape'].contains(_section);

class _Income implements IncomeRepository {
  @override
  Future<List<IncomeEntry>> income({int? categoryId, int? payerId, int? recurringTemplateId, String? from, String? to}) async => [
    for (var i = 0; i < 12; i++)
      IncomeEntry.fromJson({
        'id': i + 1,
        'categoryName': ['Interest', 'Scrap sale', 'Rent'][i % 3],
        'payerName': i.isEven ? 'Patil Traders' : null,
        'title': 'Receipt #${200 + i}',
        'amount': 2500 + i * 300,
        'paymentMethod': 'UPI',
        'paymentStatus': 'PAID',
        'amountReceived': 2500 + i * 300,
        'incomeDate': '2026-08-${10 + i}',
        'createdAt': '2026-08-${10 + i}',
      }),
  ];
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Enquiries implements EnquiriesRepository {
  @override
  Future<List<Enquiry>> enquiries() async => [
    for (var i = 0; i < 10; i++)
      Enquiry.fromJson({
        'id': i + 1,
        'referenceCode': 'ENQ-${3000 + i}',
        'kind': i.isEven ? 'ROOM' : 'EVENT',
        'name': ['Sukhada Kudalkar', 'Ramesh Patil', 'Anita Desai'][i % 3],
        'phone': '98220${10000 + i * 91}',
        'status': 'NEW',
        'createdAt': '2026-08-${10 + i}T10:00:00Z',
      }),
  ];
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Assets implements AssetsRepository {
  @override
  Future<Asset> asset(int id) async => Asset.fromJson({
    'id': id,
    'name': 'Split AC',
    'categoryName': 'Electrical',
    'assetTag': 'AST-100',
    'brand': 'Daikin',
    'model': 'FTKF50',
    'serialNumber': 'SN-99812',
    'locationNote': 'Floor 1 lobby',
    'status': 'IN_USE',
    'qrToken': 'abc123',
    'warrantyExpiry': '2027-03-10',
    'amcExpiry': '2027-01-10',
    'isActive': true,
    'openWorkOrders': 2,
  });
  @override
  Future<List<CoveragePeriod>> coverage(int id) async => const [];
  @override
  Future<List<Asset>> assets({bool includeInactive = false}) async => [
    for (var i = 0; i < 12; i++)
      Asset.fromJson({
        'id': i + 1,
        'name': ['Split AC', 'Water heater', 'CCTV camera', 'Generator'][i % 4],
        'categoryName': ['Electrical', 'Plumbing', 'Security'][i % 3],
        'assetTag': 'AST-${100 + i}',
        'locationNote': 'Floor ${i % 3 + 1}',
        'status': 'IN_USE',
        'warrantyExpiry': '2027-03-${10 + i}',
        'amcExpiry': '2027-01-${10 + i}',
        'isActive': true,
        'openWorkOrders': i % 4 == 0 ? 2 : 0,
      }),
  ];
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Staff implements StaffRepository {
  @override
  Future<List<StaffMember>> staff() async => [
    for (var i = 0; i < 6; i++)
      StaffMember.fromJson({
        'id': i + 1,
        'name': ['Sukhada Kudalkar', 'Ramesh Patil', 'Anita Desai'][i % 3],
        'phone': '98220${10000 + i * 77}',
        'roleKey': 'RECEPTION',
        'roleName': 'Reception',
        'isActive': true,
      }),
  ];
  @override
  Future<RolesCatalog> roles() async => RolesCatalog(
    roles: [
      for (final r in ['OWNER', 'RECEPTION', 'KITCHEN', 'HOUSEKEEPING'])
        LodgeRole.fromJson({
          'id': 1,
          'roleKey': r,
          'name': r[0] + r.substring(1).toLowerCase(),
          'description': 'Built-in role',
          'isSystem': true,
          'permissions': ['bookings.manage', 'billing.manage'],
          'isActive': true,
        }),
    ],
    permissions: const [],
  );
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Bookings implements BookingRepository {
  @override
  Future<List<Booking>> bookings({String? fromDate, String? toDate}) async => [
    for (var i = 0; i < 12; i++)
      Booking.fromJson({
        'id': '${i + 1}',
        'roomId': '${200 + i}',
        'guestName': ['Sukhada Kudalkar', 'Ramesh Patil', 'Anita Desai'][i % 3],
        'guestPhone': '98220${10000 + i * 53}',
        'roomNumber': '${200 + i}',
        'bookingNumber': 'BK2608${100 + i}',
        'checkInDate': '2026-08-${10 + i}',
        'checkOutDate': '2026-08-${12 + i}',
        'status': 'CHECKED_OUT',
        'totalPrice': 6400 + i * 200,
      }),
  ];
  @override
  Future<List<BookingDraft>> drafts() async => const [];
  @override
  Future<TapeChartData> tapeChart({required String startDate, required String endDate}) async {
    final d0 = DateTime.now();
    String day(int n) => d0.add(Duration(days: n)).toIso8601String().substring(0, 10);
    return TapeChartData(
      rooms: [
        for (var i = 0; i < 14; i++)
          TapeChartRoom(id: i + 1, roomNumber: '${101 + i}', categoryName: i < 7 ? 'Deluxe AC' : 'Standard'),
      ],
      bookings: [
        for (var i = 0; i < 14; i++)
          TapeChartBooking(
            id: i + 1,
            roomId: i + 1,
            guestName: ['Sukhada K', 'Ramesh P', 'Anita D'][i % 3],
            guestPhone: '98220100${i}0',
            checkInDate: day(i % 5),
            checkOutDate: day(i % 5 + 2 + i % 3),
            status: i % 4 == 0 ? 'CHECKED_IN' : 'BOOKED',
            totalPrice: 6400,
          ),
      ],
    );
  }
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Hk implements HousekeepingRepository {
  @override
  Future<List<HousekeepingRoom>> rooms() async => [
    for (var i = 0; i < 9; i++)
      HousekeepingRoom.fromJson({
        'id': i + 1,
        'kind': 'ROOM',
        'roomNumber': '${201 + i}',
        'categoryName': 'Deluxe AC',
        'floor': '${i ~/ 4 + 1}',
        'status': ['READY', 'DIRTY', 'CLEANING'][i % 3],
        'guestName': i % 3 == 1 ? 'Ramesh Patil' : null,
        'openIssues': i % 4 == 0 ? 1 : 0,
        'cleanedAt': '2026-11-23T06:00:00Z',
      }),
  ];
  @override
  Future<List<HousekeepingRoom>> venues() async => const [];
  @override
  Future<List<HousekeepingIssue>> issues({String scope = 'all'}) async => [
    for (var i = 0; i < 5; i++)
      HousekeepingIssue.fromJson({
        'logId': i + 1,
        'roomId': i + 1,
        'roomNumber': '${201 + i}',
        'kind': 'ISSUE',
        'text': 'Tap leaking in bathroom ${i + 1}',
        'reportedAt': '2026-11-22T09:00:00Z',
        'reportedBy': 'Anita Desai',
      }),
  ];
  @override
  Future<OpenIssueSummary> openIssueSummary() async => OpenIssueSummary.fromJson(const {'count': 5});
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Svc implements LodgeServicesRepository {
  @override
  Future<List<LodgeService>> services({bool includeInactive = false}) async => [
    for (var i = 0; i < 6; i++)
      LodgeService.fromJson({
        'id': i + 1,
        'name': ['Private pool', 'Gaming zone', 'Spa session'][i % 3],
        'unitLabel': 'hour',
        'price': 500 + i * 100,
        'gstRatePercent': 18,
        'isActive': true,
      }),
  ];
  @override
  Future<List<ServiceUsage>> usages({String status = 'all'}) async => const [];
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _BarRepo implements BarRepository {
  @override
  Future<List<BarOrder>> orders() async => [
    for (var i = 0; i < 7; i++)
      BarOrder.fromJson({
        'id': i + 1,
        'orderNumber': 40 + i,
        'source': 'TABLE',
        'tableLabel': 'T${i + 1}',
        'status': 'OPEN',
        'subtotal': 640 + i * 90,
        'createdAt': '2026-11-23T19:00:00Z',
      }),
  ];
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Events implements EventsRepository {
  @override
  Future<List<EventBooking>> events({String? fromDate, String? toDate, String? status, int? venueId, bool includeClosed = false}) async => [
    for (var i = 0; i < 8; i++)
      EventBooking.fromJson({
        'id': i + 1,
        'eventNumber': 'EV26${100 + i}',
        'venueId': 1,
        'venueName': 'Garden lawn',
        'eventType': 'WEDDING',
        'title': ['Patil wedding', 'Desai reception', 'Rao birthday'][i % 3],
        'organiserName': 'Ramesh Patil',
        'organiserPhone': '9822011111',
        'startAt': '2026-12-${10 + i}T10:00:00',
        'endAt': '2026-12-${10 + i}T22:00:00',
        'slot': 'CUSTOM',
        'expectedPax': 150,
        'status': 'CONFIRMED',
      }),
  ];
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

class _Customers implements CustomersRepository {
  @override
  Future<CustomersResult> customers() async => CustomersResult(
    customers: [
      for (var i = 0; i < 14; i++)
        Customer.fromJson({
          'id': i + 1,
          'name': ['Sukhada Kudalkar', 'Ramesh Patil', 'Anita Desai', 'Vikram Rao'][i % 4],
          'phone': '98220${10000 + i * 137}',
          'tags': i.isEven ? 'family, repeat' : null,
          'marketingOptIn': i % 3 == 0,
          'totalStays': i % 5 + 1,
          'totalRoomSpend': 6400 * (i % 5 + 1),
          'lastStayDate': '2026-08-${10 + i}',
        }),
    ],
    stats: const CustomersStats(total: 14, optedIn: 5),
  );
  @override
  dynamic noSuchMethod(Invocation i) => throw UnimplementedError('${i.memberName}');
}

/// Screens that poll on a timer (housekeeping, bar) never "settle"; pump a
/// bounded time instead of failing.
Future<void> settle(WidgetTester t) async {
  for (var i = 0; i < 20; i++) {
    await t.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _font(String family, List<String> files) async {
  final loader = FontLoader(family);
  for (final f in files) {
    final b = File(f).readAsBytesSync();
    loader.addFont(Future.value(ByteData.view(b.buffer)));
  }
  await loader.load();
}

void main() {
  const sizes = {
    'phone-360x800': Size(360, 800),
    'tablet-768x1024': Size(768, 1024),
    'tablet-1024x768': Size(1024, 768),
    'laptop-1366x768': Size(1366, 768),
    'desk-1440x900': Size(1440, 900),
    'wide-1920x1080': Size(1920, 1080),
    'min-960x600': Size(960, 600),
  };
  for (final e in sizes.entries.where((e) => const String.fromEnvironment('ONLY').isEmpty || e.key.contains(const String.fromEnvironment('ONLY')))) {
    testWidgets('shot ${e.key}', (t) async {
      await _font('Seg', ['C:/Windows/Fonts/segoeui.ttf']);
      await _font('MaterialIcons', ['E:/VengurlaTech/flutter/bin/cache/artifacts/material_fonts/materialicons-regular.otf']);
      t.platformDispatcher.textScaleFactorTestValue = (double.tryParse(const String.fromEnvironment('TEXT_SCALE')) ?? 1.0);
      addTearDown(t.platformDispatcher.clearTextScaleFactorTestValue);
      t.view.physicalSize = e.value;
      t.view.devicePixelRatio = 1;
      addTearDown(t.view.reset);
      final key = GlobalKey();
      await t.pumpWidget(
        ProviderScope(
          overrides: [
            networkStatusProvider.overrideWith((ref) => Stream.value(true)),
            pendingOutboxCountProvider.overrideWith((ref) => Stream.value(0)),
            attentionOutboxCountProvider.overrideWith((ref) => Stream.value(0)),
            authUsecaseProvider.overrideWithValue(AuthUsecase(_Auth())),
            apiServiceProvider.overrideWithValue(_Api()),
            customersUsecaseProvider.overrideWithValue(CustomersUsecase(_Customers())),
            expensesUsecaseProvider.overrideWithValue(ExpensesUsecase(_Expenses())),
            incomeUsecaseProvider.overrideWithValue(IncomeUsecase(_Income())),
            assetsUsecaseProvider.overrideWithValue(AssetsUsecase(_Assets())),
            eventsUsecaseProvider.overrideWithValue(EventsUsecase(_Events())),
            housekeepingUsecaseProvider.overrideWithValue(HousekeepingUsecase(_Hk())),
            lodgeServicesUsecaseProvider.overrideWithValue(LodgeServicesUsecase(_Svc())),
            barUsecaseProvider.overrideWithValue(BarUsecase(_BarRepo())),
            staffUsecaseProvider.overrideWithValue(StaffUsecase(_Staff())),
            bookingUsecaseProvider.overrideWithValue(BookingUsecase(_Bookings())),
            enquiriesUsecaseProvider.overrideWithValue(EnquiriesUsecase(_Enquiries())),
          ],
          child: RepaintBoundary(
            key: key,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: AppTheme.light.copyWith(textTheme: AppTheme.light.textTheme.apply(fontFamily: 'Seg')),
              home: _home(),
            ),
          ),
        ),
      );
      await settle(t);
      // Reach Customers: a flat tooltip row when the rail is icons, else the
      // group header then the row.
      Future<void> go() async {
        final label = const {'expenses': 'Expenses', 'income': 'Other Income', 'enquiries': 'Enquiries', 'assets': 'Asset Inventory', 'staff': 'Staff & roles', 'register': 'Guest Register', 'housekeeping': 'Housekeeping', 'services': 'Other services', 'bar': 'Bar orders & Billing', 'eventregister': 'Event register', 'tape': 'Room Chart'}[_section] ?? 'Customers';
        final group = const {'expenses': 'FINANCE & MANAGEMENT', 'income': 'FINANCE & MANAGEMENT', 'assets': 'FINANCE & MANAGEMENT', 'staff': 'SETUP', 'register': 'ROOMS', 'housekeeping': 'HOUSEKEEPING', 'services': 'ROOMS', 'bar': 'BAR', 'eventregister': 'EVENTS', 'tape': 'ROOMS'}[_section] ?? 'CUSTOMERS';
        final tip = find.byTooltip(label);
        if (tip.evaluate().isNotEmpty) {
          await t.tap(tip.first);
        } else {
          if (find.text(label).evaluate().isEmpty && find.text(group).evaluate().isNotEmpty) {
            await t.tap(find.text(group).first);
            await settle(t);
          }
          await t.tap(find.text(label).first);
        }
        await settle(t);
      }

      if (_isShell && e.key.startsWith('phone')) {
        t.state<ScaffoldState>(find.byType(Scaffold).first).openDrawer();
        await settle(t);
      }
      if (_isShell) await go();
      if (const bool.fromEnvironment('TAP_FILTER')) {
        await t.tap(find.byType(NeuFilterButton).first);
        await settle(t);
      }
      await settle(t);
      await t.runAsync(() async {
        final b = t.renderObject<RenderRepaintBoundary>(find.byKey(key));
        final img = await b.toImage();
        final data = await img.toByteData(format: ui.ImageByteFormat.png);
        await File('$_dir/$_section${const bool.fromEnvironment('TAP_FILTER') ? '-filter' : ''}-${e.key}${const String.fromEnvironment('TEXT_SCALE').isEmpty ? '' : '-x${const String.fromEnvironment('TEXT_SCALE')}'}.png').writeAsBytes(data!.buffer.asUint8List());
      });
      final ex = t.takeException();
      // Printer settings trips a framework debug assertion about a ListTile in a
      // coloured DecoratedBox at every size, phone included (pre-existing).
      if (ex != null && !'$ex'.contains('ListTile')) fail('$ex');
    });
  }
}
