import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/screens/splash_screen.dart';

void main() {
  // No overflow on a phone, a narrow window and a wide desktop, and the splash
  // hands over to `next` on a platform with no update path.
  for (final size in const [Size(360, 640), Size(320, 480), Size(1280, 800)]) {
    testWidgets('splash fits $size', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        home: SplashScreen(next: (_) => const Scaffold(body: Text('home'))),
      ));
      await tester.pump(const Duration(milliseconds: 1000));
      expect(tester.takeException(), isNull);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
    });
  }
}
