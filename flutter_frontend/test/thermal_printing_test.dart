import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/core/printing/receipt_logo.dart';
import 'package:hotel_manager/core/printing/receipt_raster.dart';
import 'package:hotel_manager/core/printing/thermal_printer.dart';
import 'package:hotel_manager/core/printing/escpos.dart';
import 'package:hotel_manager/core/printing/escpos_text.dart';
import 'package:hotel_manager/core/printing/raw_io.dart' as raw;
import 'package:hotel_manager/domain/models/bar.dart';
import 'package:hotel_manager/domain/models/invoice.dart';
import 'package:hotel_manager/domain/models/printer_config.dart';
import 'package:hotel_manager/domain/models/receipt_doc.dart';
import 'package:hotel_manager/screens/printing/thermal_receipt_pdf.dart';

Uint8List _rgba(int w, int h, bool Function(int x, int y) black) {
  final out = Uint8List(w * h * 4);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      final i = (y * w + x) * 4;
      final v = black(x, y) ? 0 : 255;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ESC/POS raster', () {
    test('packs 1 bit per dot, black first row, white second', () {
      final bytes = EscPos.raster(16, 2, _rgba(16, 2, (x, y) => y == 0), cut: false, feedLines: 0);
      // ESC @, then GS v 0 m xL xH yL yH
      expect(bytes.sublist(0, 2), [0x1B, 0x40]);
      expect(bytes.sublist(2, 10), [0x1D, 0x76, 0x30, 0x00, 2, 0, 2, 0]);
      expect(bytes.sublist(10), [0xFF, 0xFF, 0x00, 0x00]);
    });

    test('pads a width that is not a multiple of 8 and keeps bit order', () {
      // 10 wide: 2 bytes per row; only x=0 and x=9 black.
      final bytes = EscPos.raster(10, 1, _rgba(10, 1, (x, y) => x == 0 || x == 9), cut: false, feedLines: 0);
      expect(bytes.sublist(2, 10), [0x1D, 0x76, 0x30, 0x00, 2, 0, 1, 0]);
      expect(bytes.sublist(bytes.length - 2), [0x80, 0x40]);
    });

    test('splits a tall image into bands and ends with feed + cut', () {
      final bytes = EscPos.raster(8, 600, _rgba(8, 600, (x, y) => true));
      var gsv0 = 0;
      for (var i = 0; i + 2 < bytes.length; i++) {
        if (bytes[i] == 0x1D && bytes[i + 1] == 0x76 && bytes[i + 2] == 0x30) gsv0++;
      }
      expect(gsv0, 3); // 256 + 256 + 88 rows
      expect(bytes.sublist(bytes.length - 4), [0x1D, 0x56, 0x42, 0x00]);
      expect(bytes.sublist(bytes.length - 7, bytes.length - 4), [0x1B, 0x64, 3]);
    });

    test('lighter threshold prints less', () {
      final grey = Uint8List.fromList(List.generate(8 * 4, (i) => i % 4 == 3 ? 255 : 120));
      final dark = EscPos.raster(8, 1, grey, threshold: 160, cut: false, feedLines: 0);
      final light = EscPos.raster(8, 1, grey, threshold: 100, cut: false, feedLines: 0);
      expect(dark.last, 0xFF);
      expect(light.last, 0x00);
    });
  });

  group('PrinterConfig', () {
    test('round-trips through JSON and survives bad input', () {
      const c = PrinterConfig(
        transport: PrinterTransport.network,
        name: 'Counter',
        address: '192.168.1.50:9100',
        paper: ThermalPaper.mm58,
        autoCut: false,
        threshold: 140,
      );
      final back = PrinterConfig.decode(c.encode());
      expect(back.transport, PrinterTransport.network);
      expect(back.paper, ThermalPaper.mm58);
      expect(back.autoCut, isFalse);
      expect(back.threshold, 140);
      expect(PrinterConfig.decode('not json').isSet, isFalse);
      expect(PrinterConfig.decode(null).transport, PrinterTransport.none);
    });

    test('parses host and port', () {
      expect(PrinterConfig.parseHostPort('192.168.1.50')?.port, 9100);
      expect(PrinterConfig.parseHostPort('192.168.1.50:9101')?.port, 9101);
      expect(PrinterConfig.parseHostPort('printer.local:9100')?.host, 'printer.local');
      expect(PrinterConfig.parseHostPort(''), isNull);
      expect(PrinterConfig.parseHostPort('1.2.3.4:abc'), isNull);
      expect(PrinterConfig.parseHostPort('1.2.3.4:99999'), isNull);
      expect(PrinterConfig.parseHostPort('http://x'), isNull);
    });
  });

  group('receipt documents', () {
    final bill = BarBill(
      id: 1,
      billNumber: 'BAR/1',
      billDate: '2026-11-20',
      drinksSubtotal: 240,
      taxPercent: 5,
      taxAmount: 11.43,
      total: 240,
      items: const [
        BarBillLine(kind: 'DRINK', name: 'Bacardi White Rum', size: '30 ml', unitPrice: 100, quantity: 2, lineTotal: 200),
        BarBillLine(kind: 'DRINK', name: 'Budweiser Magnum Strong Premium Beer', size: 'Bottle', unitPrice: 40, quantity: 1, lineTotal: 40),
      ],
      payments: const [BarPayment(method: 'UPI', amount: 240, reference: 'T123')],
    );
    const invoice = Invoice(
      id: 9,
      invoiceNumber: 'F-12',
      kind: 'FOOD',
      tableLabel: 'T4',
      totalAmount: 360,
      foodItems: [FoodItemLine(name: 'Paneer Butter Masala', unitPrice: 180, quantity: 2, lineTotal: 360)],
    );

    test('English bills are plain ASCII, so they go as text', () {
      expect(ReceiptDocs.bar(bill, lodgeName: 'Hotel Renuka Palace').isAscii, isTrue);
      expect(ReceiptDocs.invoice(invoice, lodgeName: 'Hotel').isAscii, isTrue);
      expect(ReceiptDocs.test(lodgeName: 'Hotel', paper: '80mm').isAscii, isTrue);
    });

    test('a Marathi name is not ASCII, so it falls back to an image', () {
      expect(ReceiptDocs.bar(bill, lodgeName: 'हॉटेल').isAscii, isFalse);
    });

    for (final paper in ThermalPaper.values) {
      test('text receipt fits ${paper.label}: every line within ${paper.cols} columns', () {
        final bytes = EscPosText.encode(ReceiptDocs.bar(bill, lodgeName: 'Hotel Renuka Palace'), cols: paper.cols);
        // The printable text between control codes, line by line.
        final text = String.fromCharCodes(bytes.where((b) => b == 0x0A || (b >= 32 && b < 127)));
        for (final line in text.split('\n')) {
          // Escape-sequence arguments (e.g. 'a', 'E', '!') can trail a line, so
          // allow for the few control-code bytes that happen to be printable.
          expect(line.length, lessThanOrEqualTo(paper.cols + 8), reason: line);
        }
        expect(text, contains('Bacardi White Rum (30 ml)'));
        expect(text, contains('Rs. 240.00'));
        expect(bytes.length, lessThan(1500)); // text, not a bitmap
        expect(bytes.sublist(bytes.length - 4), EscPosText.feedAndCut);
      });

      test('receipts also render as a PDF on ${paper.label} (Windows driver)', () async {
        {
          final spec = ReceiptSpec(paper);
          for (final doc in [
            ReceiptDocs.bar(bill, lodgeName: 'Hotel'),
            ReceiptDocs.invoice(invoice, lodgeName: 'Hotel'),
            ReceiptDocs.test(lodgeName: 'Hotel', paper: paper.label),
          ]) {
            final pdf = await ThermalReceiptPdf.render(doc, spec);
            expect(String.fromCharCodes(pdf.sublist(0, 4)), '%PDF');
          }
        }
      });
    }

    test('wrap and twoCol keep to the width', () {
      expect(EscPosText.wrap('Sample item with a long name that wraps', 20), ['Sample item with a', 'long name that wraps']);
      expect(EscPosText.wrap('Supercalifragilisticexpialidocious', 10).every((l) => l.length <= 10), isTrue);
      final row = EscPosText.twoCol('TOTAL', 'Rs. 290.00', 48);
      expect(row.single.length, 48);
      expect(row.single.startsWith('TOTAL'), isTrue);
      expect(row.single.endsWith('Rs. 290.00'), isTrue);
      final long = EscPosText.twoCol('A very long product name that cannot share the line', 'Rs. 1,250.00', 32);
      expect(long.first.length, 32);
      expect(long.first.endsWith('Rs. 1,250.00'), isTrue);
      expect(long.length, greaterThan(1));
    });
  });

  group('regional text', () {
    final marathi = ReceiptDocs.test(lodgeName: 'हॉटेल रेणुका पॅलेस', paper: '80mm');

    for (final paper in ThermalPaper.values) {
      testWidgets('draws a bitmap exactly ${paper.dots} dots wide (a multiple of 8) on ${paper.label}', (tester) async {
        await tester.runAsync(() async {
          final img = await ReceiptRaster.render(marathi, paper.dots);
          expect(img.width, paper.dots);
          expect(img.width % 8, 0);
          expect(img.height, greaterThan(100));
          final rgba = await ReceiptRaster.rgba(img);
          expect(rgba.length, img.width * img.height * 4);
          // Something is drawn: at least some dark pixels, and mostly paper.
          var dark = 0;
          for (var i = 0; i < rgba.length; i += 4) {
            if (rgba[i] < 128) dark++;
          }
          expect(dark, greaterThan(200));
          expect(dark, lessThan(img.width * img.height ~/ 2));
        });
      });
    }

    testWidgets('a Marathi bill goes to the printer as raster, an English one as text', (tester) async {
      await tester.runAsync(() async {
        const cfg = PrinterConfig(transport: PrinterTransport.bluetooth, address: 'AA:BB', paper: ThermalPaper.mm80);
        final image = await ThermalPrinterService.escposBytes(cfg, marathi);
        // GS v 0 raster command present, and far larger than a text receipt.
        var raster = false;
        for (var i = 0; i + 2 < image.length; i++) {
          if (image[i] == 0x1D && image[i + 1] == 0x76 && image[i + 2] == 0x30) raster = true;
        }
        expect(raster, isTrue);
        expect(image.length, greaterThan(3000));

        // English as text is the Plain style; Boxed is always a picture.
        final text = await ThermalPrinterService.escposBytes(cfg.copyWith(style: ReceiptStyle.plain), ReceiptDocs.test(lodgeName: 'Hotel', paper: '80mm'));
        expect(text.length, lessThan(1500));
      });
    });
  });

  group('logo', () {
    // 100 x 40 black block.
    final logo = ReceiptLogo(100, 40, Uint8List.fromList(List.generate(100 * 40 * 4, (i) => i % 4 == 3 ? 255 : 0)));
    final doc = ReceiptDocs.test(lodgeName: 'Hotel', paper: '80mm').withLogo(logo);

    test('text receipts start with the logo, centred on the full line', () {
      final bytes = EscPosText.encode(doc, cols: 48, dots: 576);
      // GS v 0, 72 bytes per row (576 dots), 40 rows.
      expect(bytes.sublist(0, 8), [0x1D, 0x76, 0x30, 0x00, 72, 0, 40, 0]);
      // Left margin of (576-100)/2 = 238 dots = 29 whole bytes of paper, then ink.
      expect(bytes.sublist(8, 8 + 29), everyElement(0));
      expect(bytes[8 + 29], isNot(0));
      // And the text still follows, as text.
      expect(String.fromCharCodes(bytes.where((b) => b >= 32 && b < 127)), contains('Printer test'));
      expect(EscPosText.encode(doc, cols: 48, dots: 576).length, lessThan(6000));
    });

    test('no logo, no image bytes', () {
      final bytes = EscPosText.encode(ReceiptDocs.test(lodgeName: 'Hotel', paper: '80mm'), cols: 48, dots: 576);
      expect(bytes.sublist(0, 3), isNot([0x1D, 0x76, 0x30]));
    });

    test('the Windows PDF carries it too', () async {
      final withLogo = await ThermalReceiptPdf.render(doc, const ReceiptSpec(ThermalPaper.mm80));
      final without = await ThermalReceiptPdf.render(ReceiptDocs.test(lodgeName: 'Hotel', paper: '80mm'), const ReceiptSpec(ThermalPaper.mm80));
      expect(withLogo.length, greaterThan(without.length));
    });

    testWidgets('the picture path draws it above the text', (tester) async {
      await tester.runAsync(() async {
        final plain = await ReceiptRaster.render(ReceiptDocs.test(lodgeName: 'Hotel', paper: '80mm'), 576);
        final withLogo = await ReceiptRaster.render(doc, 576);
        expect(withLogo.height, plain.height + 40 + 8);
      });
    });

    testWidgets('a large transparent logo is shrunk to fit and reduced to black and white', (tester) async {
      await tester.runAsync(() async {
        final rec = ui.PictureRecorder();
        ui.Canvas(rec).drawRect(const ui.Rect.fromLTWH(20, 20, 260, 60), ui.Paint()..color = const ui.Color(0xFF1457AD));
        final img = await rec.endRecording().toImage(1000, 400); // transparent background
        final png = (await img.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();

        final out = await ReceiptLogoLoader.fromBytes(png, maxWidth: 288);
        expect(out, isNotNull);
        expect(out!.width, lessThanOrEqualTo(288));
        expect(out.height, lessThanOrEqualTo(ReceiptLogoLoader.maxHeight));
        // Same proportions as the 1000 x 400 source.
        expect(out.width / out.height, closeTo(2.5, 0.2));
        // Only pure black or white, and the transparent part is paper (white), not black.
        final values = <int>{for (var i = 0; i < out.rgba.length; i += 4) out.rgba[i]};
        expect(values, {0, 255});
        expect(out.rgba[0], 255);
      });
    });
  });

  group('boxed style', () {
    final doc = ReceiptDocs.test(lodgeName: 'Hotel', paper: '80mm');

    testWidgets('draws an outer border and a ruled table', (tester) async {
      await tester.runAsync(() async {
        final boxed = await ReceiptRaster.render(doc, 576, boxed: true);
        final plain = await ReceiptRaster.render(doc, 576);
        final px = await ReceiptRaster.rgba(boxed);
        bool dark(int x, int y) => px[(y * boxed.width + x) * 4] < 128;

        // The border: the whole left and right edge, top and bottom edge.
        for (final y in [5, boxed.height ~/ 2, boxed.height - 6]) {
          expect(dark(0, y) || dark(1, y), isTrue, reason: 'left edge at $y');
          expect(dark(boxed.width - 1, y) || dark(boxed.width - 2, y), isTrue, reason: 'right edge at $y');
        }
        for (final x in [20, 288, 550]) {
          expect(dark(x, 0) || dark(x, 1), isTrue, reason: 'top edge at $x');
          expect(dark(x, boxed.height - 1) || dark(x, boxed.height - 2), isTrue, reason: 'bottom edge at $x');
        }
        // A table row rule: some row is dark almost end to end.
        var fullRules = 0;
        for (var y = 0; y < boxed.height; y++) {
          var n = 0;
          for (var x = 0; x < boxed.width; x++) {
            if (dark(x, y)) n++;
          }
          if (n > boxed.width * 0.95) fullRules++;
        }
        expect(fullRules, greaterThanOrEqualTo(6)); // blocks + table rows
        // The plain style has no border.
        final pp = await ReceiptRaster.rgba(plain);
        expect(pp[((plain.height ~/ 2) * plain.width) * 4], 255);
      });
    });

    test('the table is text lines for plain output', () {
      final lines = doc.textLines;
      expect(lines.whereType<RTable>(), isEmpty);
      expect(lines.whereType<RItem>().length, 2);
      final text = String.fromCharCodes(EscPosText.encode(doc, cols: 48).where((b) => b >= 32 && b < 127));
      expect(text, contains('Sample item with a long name'));
    });

    testWidgets('boxed always goes as a picture, plain as text when it is ASCII', (tester) async {
      await tester.runAsync(() async {
        const boxedCfg = PrinterConfig(transport: PrinterTransport.network, address: '1.2.3.4');
        final plainCfg = boxedCfg.copyWith(style: ReceiptStyle.plain);
        bool isRaster(Uint8List b) {
          for (var i = 0; i + 2 < b.length; i++) {
            if (b[i] == 0x1D && b[i + 1] == 0x76 && b[i + 2] == 0x30) return true;
          }
          return false;
        }

        expect(boxedCfg.style, ReceiptStyle.boxed); // the default
        expect(isRaster(await ThermalPrinterService.escposBytes(boxedCfg, doc)), isTrue);
        expect(isRaster(await ThermalPrinterService.escposBytes(plainCfg, doc)), isFalse);
        // A Marathi plain receipt still has to be a picture.
        final marathi = ReceiptDocs.test(lodgeName: 'हॉटेल', paper: '80mm');
        expect(isRaster(await ThermalPrinterService.escposBytes(plainCfg, marathi)), isTrue);
      });
    });

    test('style survives the saved JSON, and older saves default to boxed', () {
      final c = const PrinterConfig(transport: PrinterTransport.network, address: 'x').copyWith(style: ReceiptStyle.plain);
      expect(PrinterConfig.decode(c.encode()).style, ReceiptStyle.plain);
      expect(PrinterConfig.fromJson({'transport': 'network', 'address': 'x'}).style, ReceiptStyle.boxed);
    });
  });

  group('network transport', () {
    test('delivers the exact bytes to a printer socket', () async {
      final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final got = Completer<List<int>>();
      final buf = <int>[];
      server.listen((s) {
        s.listen(buf.addAll, onDone: () => got.complete(buf));
      });
      final payload = Uint8List.fromList(List.generate(5000, (i) => i % 251));
      await raw.sendTcp('127.0.0.1', server.port, payload);
      expect(await got.future.timeout(const Duration(seconds: 5)), payload);
      await server.close();
    });

    test('an unreachable printer gives a readable message', () async {
      final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final port = server.port;
      await server.close(); // nothing listens here now
      await expectLater(
        raw.sendTcp('127.0.0.1', port, Uint8List(4)),
        throwsA(isA<ThermalPrintException>().having((e) => e.message, 'message', contains('not reachable'))),
      );
    });
  });
}
