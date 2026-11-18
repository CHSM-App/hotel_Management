import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/presentation/providers/network_provider.dart';
import 'package:hotel_manager/screens/shell/offline_scope.dart';

Widget host(String key, bool online) => ProviderScope(
  overrides: [
    networkStatusProvider.overrideWith((ref) => Stream.value(online)),
    lastSyncProvider.overrideWith((ref) async => DateTime(2026, 11, 17, 9, 5)),
  ],
  child: MaterialApp(home: Scaffold(body: OfflineScope(sectionKey: key, child: const Text('body')))),
);

void main() {
  testWidgets('offline, a non-offline section shows the note and last sync', (t) async {
    await t.pumpWidget(host('expenses', false));
    await t.pumpAndSettle();
    expect(find.textContaining('unavailable offline'), findsOneWidget);
    expect(find.textContaining('17 Nov, 9:05 AM'), findsOneWidget);
    expect(find.text('body'), findsOneWidget);
  });
  testWidgets('offline-capable sections and online use show no note', (t) async {
    await t.pumpWidget(host('billing', false));
    await t.pumpAndSettle();
    expect(find.textContaining('unavailable offline'), findsNothing);
    await t.pumpWidget(const SizedBox());
    await t.pumpWidget(host('expenses', true));
    await t.pumpAndSettle();
    expect(find.textContaining('unavailable offline'), findsNothing);
  });
}
