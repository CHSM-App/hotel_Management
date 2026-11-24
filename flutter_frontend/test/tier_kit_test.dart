import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/screens/theme.dart';
import 'package:hotel_manager/widgets/app_dialog.dart';
import 'package:hotel_manager/widgets/desk_table.dart';
import 'package:hotel_manager/screens/reports/report_widgets.dart';
import 'package:hotel_manager/widgets/page_kit.dart';

Future<void> _pump(WidgetTester t, Size size, Widget child) async {
  t.view.physicalSize = size;
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  await t.pumpWidget(MaterialApp(theme: AppTheme.light, home: Scaffold(body: child)));
}

void main() {
  searchShortcutTest();
  test('tier cutoffs match the brief', () {
    expect(AppTheme.tierOfWidth(599), Tier.phone);
    expect(AppTheme.tierOfWidth(600), Tier.tablet);
    expect(AppTheme.tierOfWidth(1023), Tier.tablet);
    expect(AppTheme.tierOfWidth(1024), Tier.laptop);
    expect(AppTheme.tierOfWidth(1439), Tier.laptop);
    expect(AppTheme.tierOfWidth(1440), Tier.desktop);
    expect(AppTheme.tierOfWidth(1919), Tier.desktop);
    expect(AppTheme.tierOfWidth(1920), Tier.wide);
  });

  testWidgets('DeskTable drops a low-priority column on tablet and laptop only', (t) async {
    Widget table() => SizedBox(
      height: 400,
      child: DeskTable(
        columns: const [
          DeskColumn('Name', 160),
          DeskColumn('Notes', 160, lowPriority: true),
        ],
        rows: const [
          DeskRow(cells: [Text('A'), Text('note-A')]),
        ],
      ),
    );
    await _pump(t, const Size(1280, 800), table());
    expect(find.text('NOTES'), findsNothing);
    expect(find.text('note-A'), findsNothing);
    expect(find.text('A'), findsOneWidget);
    await _pump(t, const Size(400, 800), table());
    expect(find.text('NOTES'), findsOneWidget);
    await _pump(t, const Size(1600, 900), table());
    expect(find.text('NOTES'), findsOneWidget);
    expect(find.text('note-A'), findsOneWidget);
  });

  testWidgets('KpiRow: 2 per row on a tablet, 3 on a laptop, 4 on a desktop', (t) async {
    Widget row() => KpiRow(items: [
      for (var i = 0; i < 4; i++) KpiCardData(label: 'k$i', value: '$i', sub: ''),
    ]);
    double dy(String k) => t.getTopLeft(find.text(k.toUpperCase())).dy;
    await _pump(t, const Size(800, 900), row());
    expect(dy('k2'), greaterThan(dy('k0')));
    await _pump(t, const Size(1200, 900), row());
    expect(dy('k2'), dy('k0'));
    expect(dy('k3'), greaterThan(dy('k0')));
    await _pump(t, const Size(1600, 900), row());
    expect(dy('k3'), dy('k0'));
  });

  testWidgets('MasterDetail splits by pane width only', (t) async {
    Widget md() => const MasterDetail(master: Text('list'), detail: Text('detail'));
    await _pump(t, const Size(900, 800), md());
    expect(find.text('detail'), findsNothing);
    await _pump(t, const Size(1400, 800), md());
    expect(find.text('detail'), findsOneWidget);
  });

  testWidgets('showAppDialog: sheet on a phone, centred dialog on a tablet', (t) async {
    Widget opener() => Builder(
      builder: (c) => TextButton(
        onPressed: () => showAppDialog<void>(c, builder: (_) => const SizedBox(height: 100, child: Text('body'))),
        child: const Text('open'),
      ),
    );
    await _pump(t, const Size(400, 800), opener());
    await t.tap(find.text('open'));
    await t.pumpAndSettle();
    expect(find.byType(BottomSheet), findsOneWidget);
    expect(find.byType(Dialog), findsNothing);
    await t.tapAt(const Offset(200, 20));
    await t.pumpAndSettle();
    await _pump(t, const Size(1000, 800), opener());
    await t.tap(find.text('open'));
    await t.pumpAndSettle();
    expect(find.byType(Dialog), findsOneWidget);
    expect(t.getSize(find.ancestor(of: find.text('body'), matching: find.byType(SingleChildScrollView)).first).width, AppDialogWidth.action);
    await t.sendKeyEvent(LogicalKeyboardKey.escape);
    await t.pumpAndSettle();
    expect(find.byType(Dialog), findsNothing);
  });
}

void searchShortcutTest() {
  testWidgets('Ctrl+F focuses the search box from anywhere on the page', (t) async {
    final node = FocusNode();
    addTearDown(node.dispose);
    await _pump(
      t,
      const Size(1200, 800),
      SearchShortcut(
        focusNode: node,
        child: Column(children: [TextField(focusNode: node), const SizedBox(height: 10)]),
      ),
    );
    expect(node.hasFocus, isFalse);
    await t.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await t.sendKeyEvent(LogicalKeyboardKey.keyF);
    await t.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await t.pump();
    expect(node.hasFocus, isTrue);
  });
}
