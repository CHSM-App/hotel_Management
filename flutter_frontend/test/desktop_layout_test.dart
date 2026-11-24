import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/widgets/adaptive_grid.dart';
import 'package:hotel_manager/widgets/h_scroll_table.dart';
import 'package:hotel_manager/widgets/id_proof_fields.dart';
import 'package:hotel_manager/widgets/neu.dart';

/// The two building blocks of the wide-window layouts: a table that grows its
/// columns to fill the window (and stays exactly as it was on a phone), and a
/// card grid that adds columns as the window widens.

Widget _table(double viewport) => MaterialApp(
  home: Scaffold(
    body: Align(
      alignment: Alignment.topLeft,
      child: SizedBox(
        width: viewport,
        height: 300,
        child: const HScrollTable(
          rowsScrollbar: true,
          child: TableSheet(
            width: 600,
            child: StickyHeaderTable(
              header: Row(
                children: [
                  TableCol(width: 200, child: Text('a', key: Key('a'))),
                  TableCol(width: 400, child: Text('b', key: Key('b'))),
                ],
              ),
              rows: [],
            ),
          ),
        ),
      ),
    ),
  ),
);

void main() {
  setUp(() {});
  testWidgets('table: a phone-width viewport keeps the columns as designed', (tester) async {
    tester.view.physicalSize = const Size(6000, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_table(400));
    expect(tester.getSize(find.byType(TableSheet)).width, 600);
    expect(tester.getSize(find.ancestor(of: find.byKey(const Key('a')), matching: find.byType(SizedBox)).first).width, 200);
  });

  testWidgets('table: a wide window stretches every column in proportion, no overflow', (tester) async {
    tester.view.physicalSize = const Size(1700, 1000); // desktop tier: cap 3x
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_table(1414));
    final sheet = tester.getSize(find.byType(TableSheet)).width;
    expect(sheet, closeTo(1400, 1));
    final a = tester.getSize(find.ancestor(of: find.byKey(const Key('a')), matching: find.byType(SizedBox)).first).width;
    final b = tester.getSize(find.ancestor(of: find.byKey(const Key('b')), matching: find.byType(SizedBox)).first).width;
    expect(b / a, closeTo(2, 0.01)); // 200 : 400 kept
    expect(a + b, closeTo(1400, 1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('table: growth is capped so a huge window does not smear it', (tester) async {
    tester.view.physicalSize = const Size(6000, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_table(5000));
    expect(tester.getSize(find.byType(TableSheet)).width, 600 * 2.2); // wide tier cap
  });

  Widget grid(double w, int n) => MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: Align(
          alignment: Alignment.topLeft,
          child: SizedBox(
            width: w,
            child: AdaptiveGrid(
              children: [for (var i = 0; i < n; i++) SizedBox(key: Key('c$i'), height: 50)],
            ),
          ),
        ),
      ),
    ),
  );

  testWidgets('grid: one column on a phone, more as the window widens', (tester) async {
    tester.view.physicalSize = const Size(6000, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(grid(360, 4));
    expect(tester.getTopLeft(find.byKey(const Key('c1'))).dy, greaterThan(tester.getTopLeft(find.byKey(const Key('c0'))).dy));

    await tester.pumpWidget(grid(1300, 4));
    // 3 columns: c0..c2 share a row, c3 wraps.
    final y0 = tester.getTopLeft(find.byKey(const Key('c0'))).dy;
    expect(tester.getTopLeft(find.byKey(const Key('c2'))).dy, y0);
    expect(tester.getTopLeft(find.byKey(const Key('c3'))).dy, greaterThan(y0));
    expect(tester.takeException(), isNull);
  });

  Widget idFields(double w) => MaterialApp(
    home: Scaffold(
      body: Align(
        alignment: Alignment.topLeft,
        child: SizedBox(
          width: w,
          child: IdProofFields(
            type: 'AADHAAR',
            number: TextEditingController(),
            onType: (_) {},
            onFile: (_) {},
          ),
        ),
      ),
    ),
  );

  testWidgets('ID proof: type, number and photo share one row when wide, stack when narrow', (tester) async {
    tester.view.physicalSize = const Size(2000, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(idFields(900));
    final typeY = tester.getTopLeft(find.text('ID proof')).dy;
    final numberY = tester.getTopLeft(find.text('ID number')).dy;
    expect(numberY, closeTo(typeY, 2)); // same row
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(idFields(360));
    expect(tester.getTopLeft(find.text('ID number')).dy, greaterThan(tester.getTopLeft(find.text('ID proof')).dy + 20));
    expect(tester.takeException(), isNull);
  });

  testWidgets('shared field and button are compact on a wide window, unchanged on a phone', (tester) async {
    Future<(double, double)> sizes(double w) async {
      tester.view.physicalSize = Size(w, 900);
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Align(
              alignment: Alignment.topLeft,
              child: SizedBox(
                width: 360,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    NeuField(controller: TextEditingController(), label: 'Name'),
                    NeuButton(onPressed: () {}, child: const Text('Save')),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle(); // the controls animate between sizes
      return (tester.getSize(find.byType(NeuField)).height, tester.getSize(find.byType(NeuButton)).height);
    }

    addTearDown(tester.view.reset);
    final phone = await sizes(400);
    final desktop = await sizes(1400);
    expect(desktop.$1, lessThan(phone.$1 - 8));
    expect(desktop.$2, lessThan(phone.$2 - 6));
    expect(phone.$2, greaterThanOrEqualTo(44));
  });
}
