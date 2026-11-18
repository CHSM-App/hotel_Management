import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/core/offline/outbox_status.dart';
import 'package:hotel_manager/presentation/providers/network_provider.dart';
import 'package:hotel_manager/screens/shell/dashboard_shell.dart';

Widget _host({required bool? online, required int waiting}) => ProviderScope(
  overrides: [
    networkStatusProvider.overrideWith(
      (ref) => online == null ? const Stream<bool>.empty() : Stream.value(online),
    ),
    pendingOutboxCountProvider.overrideWith((ref) => Stream.value(waiting)),
  ],
  child: const MaterialApp(
    home: Scaffold(body: Column(children: [Expanded(child: SizedBox()), ConnectionStrip()])),
  ),
);

void main() {
  testWidgets('hidden while online with nothing waiting', (t) async {
    await t.pumpWidget(_host(online: true, waiting: 0));
    await t.pumpAndSettle();
    expect(find.textContaining('No connection'), findsNothing);
    expect(find.textContaining('waiting'), findsNothing);
  });

  testWidgets('hidden before the first probe answers (no flash on cold start)', (t) async {
    await t.pumpWidget(_host(online: null, waiting: 0));
    await t.pumpAndSettle();
    expect(find.textContaining('No connection'), findsNothing);
  });

  testWidgets('says No connection when offline', (t) async {
    await t.pumpWidget(_host(online: false, waiting: 0));
    await t.pumpAndSettle();
    expect(find.text('No connection'), findsOneWidget);
  });

  testWidgets('offline with saved actions says how many will sync', (t) async {
    await t.pumpWidget(_host(online: false, waiting: 2));
    await t.pumpAndSettle();
    expect(find.text('No connection · 2 saved, will sync when back'), findsOneWidget);
  });

  testWidgets('online but not yet synced shows the waiting count', (t) async {
    await t.pumpWidget(_host(online: true, waiting: 3));
    await t.pumpAndSettle();
    expect(find.text('3 waiting to sync'), findsOneWidget);
  });
}
