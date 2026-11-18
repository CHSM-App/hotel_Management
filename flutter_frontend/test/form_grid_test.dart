import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/widgets/form_grid.dart';

Future<void> _pump(WidgetTester t, double width) async {
  t.view.physicalSize = Size(width, 900);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.reset);
  await t.pumpWidget(_host(width));
}

Widget _host(double width) => MaterialApp(
  home: MediaQuery(
    data: MediaQueryData(size: Size(width, 900)),
    child: Scaffold(
      body: Center(
        child: SizedBox(
          width: width,
          child: FormGrid(
            maxColumns: 3,
            children: const [
              SizedBox(key: Key('a'), height: 40),
              SizedBox(key: Key('b'), height: 40),
              FormSpan.full(child: SizedBox(key: Key('c'), height: 40)),
            ],
          ),
        ),
      ),
    ),
  ),
);

void main() {
  testWidgets('one column on a phone', (t) async {
    await _pump(t, 360);
    expect(t.getSize(find.byKey(const Key('a'))).width, 360);
    expect(t.getTopLeft(find.byKey(const Key('b'))).dy, greaterThan(t.getTopLeft(find.byKey(const Key('a'))).dy));
  });

  testWidgets('two columns at tablet width, full span stays full', (t) async {
    await _pump(t, 768);
    expect(t.getTopLeft(find.byKey(const Key('b'))).dy, t.getTopLeft(find.byKey(const Key('a'))).dy);
    expect(t.getSize(find.byKey(const Key('c'))).width, 768);
  });

  testWidgets('three columns on desktop', (t) async {
    await _pump(t, 1200);
    expect(t.getSize(find.byKey(const Key('a'))).width, closeTo((1200 - 32) / 3, 0.5));
  });
}
