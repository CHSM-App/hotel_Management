import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/painting.dart';

import '../../domain/models/receipt_doc.dart';

/// Draws a [ReceiptDoc] to a bitmap with Flutter's own text engine.
///
/// Two uses: receipts with text a printer's font cannot print (Marathi, Hindi),
/// and the *boxed* style — an outer border, rules between the blocks and a
/// ruled Item / Qty / Price / Total table — which only a picture can carry.
///
/// The engine shapes the text (half-letters, matras, conjuncts), which neither a
/// printer's font ROM nor the `pdf` package can. Columns are drawn at x
/// positions (name left, amount right) rather than padded with spaces, because
/// these glyphs are proportional.
///
/// Drawn at 2x and scaled down so thin strokes survive the 1-bit conversion;
/// the width is the printer's own dot width, always a multiple of 8.
class ReceiptRaster {
  ReceiptRaster._();

  /// The bundled font (assets/fonts, registered in pubspec.yaml) used for any
  /// glyph the default font lacks. Never rely on the system having one.
  static const regionalFont = 'NotoSansDevanagari';

  /// Overrides the default font family for the Latin text — only so a test can
  /// load a real font (the test engine's default draws solid blocks).
  static String? fontFamily;

  static const _ink = Color(0xFF000000);
  static const _supersample = 2;

  // Text sizes in printer dots (203 dpi) for an 80mm roll; a 58mm roll scales
  // them down (see [_narrow]). Thermal heads print thin strokes lightly, so
  // these are generous: 26 dots is a little taller than the printer's own
  // 24-dot font.
  static const _normal = 26.0;
  static const _small = 21.0;
  static const _big = 36.0;
  static const _rowBig = 34.0;
  static const _cell = 24.0;

  /// Rolls narrower than this (58mm is 384 dots) use smaller text and a
  /// narrower name column, so a figure like 1250.00 still fits its cell.
  static bool _narrow(int width) => width < 500;

  /// Item | Qty | Price | Total, as shares of the width.
  static const _columns = [0.40, 0.12, 0.24, 0.24];
  static const _columnsNarrow = [0.34, 0.12, 0.27, 0.27];

  static const _border = 2.0;
  static const _pad = 10.0;

  static Future<ui.Image> render(ReceiptDoc doc, int width, {bool boxed = false}) async {
    final w = width.toDouble();
    final k = _narrow(width) ? 0.85 : 1.0;
    final fsNormal = _normal * k;
    final fsSmall = _small * k;
    final fsBig = _big * k;
    final draws = <void Function(Canvas)>[];
    var y = 0.0;

    // The area text lives in. Boxed: inside the border with some air.
    final left = boxed ? _border + _pad : 0.0;
    final inner = boxed ? w - 2 * (_border + _pad) : w;

    TextPainter text(String s, double size, {bool bold = false, bool center = false, bool right = false, double? maxWidth}) {
      final p = TextPainter(
        text: TextSpan(
          text: s,
          style: TextStyle(
            color: _ink,
            fontSize: size,
            fontFamily: fontFamily,
            fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
            height: 1.25,
            fontFamilyFallback: const [regionalFont],
          ),
        ),
        textAlign: center ? TextAlign.center : (right ? TextAlign.right : TextAlign.left),
        textDirection: TextDirection.ltr,
      );
      final mw = maxWidth ?? double.infinity;
      p.layout(minWidth: (center || right) && mw.isFinite ? mw : 0, maxWidth: mw);
      return p;
    }

    void put(TextPainter p, double x, double top) => draws.add((c) => p.paint(c, Offset(x, top)));

    void line(double x1, double y1, double x2, double y2, double weight) {
      draws.add((c) => c.drawLine(
        Offset(x1, y1),
        Offset(x2, y2),
        Paint()
          ..color = _ink
          ..strokeWidth = weight,
      ));
    }

    /// Left text and a right-aligned figure sharing a line; the left wraps.
    double pair(String l, String r, double size, {bool bold = false, bool boldLeft = false}) {
      final rp = text(r, size, bold: bold);
      final lp = text(l, size, bold: bold || boldLeft, maxWidth: math.max(60, inner - rp.width - 12));
      put(lp, left, y);
      put(rp, left + inner - rp.width, y);
      return math.max(lp.height, rp.height);
    }

    if (boxed) y += _border + 8;

    final logo = doc.logo;
    if (logo != null && logo.width <= width) {
      final image = await _imageOf(logo);
      final x = (w - logo.width) / 2;
      final top = y;
      draws.add((c) => c.drawImageRect(
        image,
        Rect.fromLTWH(0, 0, logo.width.toDouble(), logo.height.toDouble()),
        Rect.fromLTWH(x, top, logo.width.toDouble(), logo.height.toDouble()),
        Paint()..filterQuality = FilterQuality.none,
      ));
      y += logo.height + 8;
    }

    // Plain style has no grid, so a table is written out as item lines.
    for (final l in boxed ? doc.lines : doc.textLines) {
      switch (l) {
        case RText():
          final size = switch (l.size) {
            RSize.big => fsBig,
            RSize.small => fsSmall,
            RSize.normal => fsNormal,
          };
          final p = text(l.text, size, bold: l.bold || l.size == RSize.big, center: l.center, maxWidth: inner);
          put(p, left, y);
          y += p.height + 2;
        case RRow():
          y += pair(l.left, l.right, l.big ? _rowBig * k : fsNormal, bold: l.bold || l.big) + 2;
        case RItem():
          final name = text(l.name, fsNormal, bold: true, maxWidth: inner);
          y += 4;
          put(name, left, y);
          y += name.height;
          y += pair(l.qtyRate ?? '', l.amount, fsNormal) + 2;
        case RNote():
          final p = text(l.text, fsSmall, maxWidth: inner - 16);
          put(p, left + 16, y);
          y += p.height;
        case RTable():
          y = _table(l, y, w, k, _narrow(width), text, put, line);
        case RRule():
          if (boxed) {
            // A full-width rule between blocks, with air above and below.
            y += 4;
            line(0, y, w, y, _border);
            y += _border + 6;
          } else {
            final ry = y + 6;
            final strong = l.strong;
            draws.add((c) {
              final paint = Paint()
                ..color = _ink
                ..strokeWidth = strong ? 2.5 : 1.5;
              if (strong) {
                c.drawLine(Offset(0, ry), Offset(w, ry), paint);
              } else {
                for (var x = 0.0; x < w; x += 12) {
                  c.drawLine(Offset(x, ry), Offset(math.min(x + 6, w), ry), paint);
                }
              }
            });
            y += 14;
          }
        case RGap():
          y += 10;
      }
    }

    y += boxed ? 8 : 16;
    final height = math.max(1, y.ceil() + (boxed ? _border.ceil() : 0));
    if (boxed) {
      // The outer border, drawn last so it sits over everything.
      draws.add((c) => c.drawRect(
        Rect.fromLTWH(_border / 2, _border / 2, w - _border, height - _border),
        Paint()
          ..color = _ink
          ..style = PaintingStyle.stroke
          ..strokeWidth = _border,
      ));
    }

    final s = _supersample.toDouble();

    final big = ui.PictureRecorder();
    final bigCanvas = Canvas(big)
      ..scale(s)
      ..drawColor(const Color(0xFFFFFFFF), BlendMode.src);
    for (final d in draws) {
      d(bigCanvas);
    }
    final hi = await big.endRecording().toImage(width * _supersample, height * _supersample);

    final small = ui.PictureRecorder();
    Canvas(small).drawImageRect(
      hi,
      Rect.fromLTWH(0, 0, hi.width.toDouble(), hi.height.toDouble()),
      Rect.fromLTWH(0, 0, w, height.toDouble()),
      Paint()..filterQuality = FilterQuality.high,
    );
    final out = await small.endRecording().toImage(width, height);
    hi.dispose();
    return out;
  }

  /// The items table: a header row, a row per item, rules between the rows and
  /// between the columns. Cells that are too long wrap. Returns the new y.
  static double _table(
    RTable t,
    double y0,
    double w,
    double k,
    bool narrow,
    TextPainter Function(String, double, {bool bold, bool center, bool right, double? maxWidth}) text,
    void Function(TextPainter, double, double) put,
    void Function(double, double, double, double, double) line,
  ) {
    var y = y0;
    final xs = <double>[0];
    for (final f in narrow ? _columnsNarrow : _columns) {
      xs.add(xs.last + w * f);
    }
    final hpad = narrow ? 5.0 : 8.0;
    const vpad = 6.0;
    final rules = <double>[];

    double row(List<String> cells, {required bool header}) {
      final ps = <TextPainter>[];
      var h = 0.0;
      for (var i = 0; i < 4; i++) {
        final cw = xs[i + 1] - xs[i] - 2 * hpad;
        final p = text(
          cells[i],
          _cell * k,
          bold: header,
          center: header || i == 1,
          right: !header && i >= 2,
          maxWidth: cw,
        );
        ps.add(p);
        h = math.max(h, p.height);
      }
      for (var i = 0; i < 4; i++) {
        put(ps[i], xs[i] + hpad, y + vpad);
      }
      return h + 2 * vpad;
    }

    final top = y;
    y += row(t.headers, header: true);
    rules.add(y);
    for (final r in t.rows) {
      y += row(r, header: false);
      rules.add(y);
    }
    final bottom = y;

    for (final ry in rules) {
      line(0, ry, w, ry, 1.5);
    }
    for (var i = 1; i < 4; i++) {
      line(xs[i], top, xs[i], bottom, 1.5);
    }
    return y + 6; // air before the totals
  }

  static Future<ui.Image> _imageOf(ReceiptLogo logo) {
    final done = Completer<ui.Image>();
    ui.decodeImageFromPixels(logo.rgba, logo.width, logo.height, ui.PixelFormat.rgba8888, done.complete);
    return done.future;
  }

  static Future<Uint8List> rgba(ui.Image image) async {
    final bd = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    if (bd == null) throw StateError('Could not read the rendered receipt.');
    return bd.buffer.asUint8List();
  }

  static Future<Uint8List> png(ui.Image image) async {
    final bd = await image.toByteData(format: ui.ImageByteFormat.png);
    if (bd == null) throw StateError('Could not encode the rendered receipt.');
    return bd.buffer.asUint8List();
  }
}
