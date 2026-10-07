import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:hotel_manager/domain/models/housekeeping.dart';
import 'package:hotel_manager/domain/repository/housekeeping_repo.dart';
import 'package:hotel_manager/domain/usecase/housekeeping_usecase.dart';
import 'package:hotel_manager/presentation/providers/usecase_provider.dart';
import 'package:hotel_manager/screens/housekeeping/rooms_tab.dart';

class FakeHkRepo implements HousekeepingRepository {
  @override
  Future<List<HousekeepingRoom>> rooms() async => [
    const HousekeepingRoom(
      id: 1,
      roomNumber: '3',
      categoryName: 'Standard',
      floor: 'Ground',
      status: 'DIRTY',
      dirtySince: '2026-10-07T10:00:00Z',
    ),
    const HousekeepingRoom(
      id: 2,
      roomNumber: '106',
      categoryName: 'Super-Deluxe',
      floor: '1',
      status: 'CLEANING',
      cleaningStartedAt: '2026-10-06T18:00:00Z',
      cleaningBy: 'Asha',
    ),
  ];

  @override
  Future<void> startCleaning(int roomId) async {}
  @override
  Future<void> releaseRoom(int roomId) async {}
  @override
  Future<void> finishCleaning(int roomId, Map<String, dynamic> body) async {}
  @override
  Future<void> markDirty(int roomId) async {}
  @override
  Future<void> setOutOfOrder(int roomId, Map<String, dynamic> body) async {}
  @override
  Future<List<HousekeepingIssue>> issues({String scope = 'all'}) async => [];
  @override
  Future<OpenIssueSummary> openIssueSummary() async => const OpenIssueSummary();
  @override
  Future<void> closeIssue(int logId, Map<String, dynamic> body) async {}
}

void main() {
  testWidgets('RoomsTab renders cards without throwing', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          housekeepingUsecaseProvider.overrideWith((ref) => HousekeepingUsecase(FakeHkRepo())),
        ],
        child: const MaterialApp(home: Scaffold(body: RoomsTab())),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    final exception = tester.takeException();
    if (exception != null) {
      // ignore: avoid_print
      print('EXCEPTION: $exception');
    }
    expect(exception, isNull);
    expect(find.text('3'), findsOneWidget);
  });
}
