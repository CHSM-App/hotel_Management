import 'dart:typed_data';

import '../../domain/models/receipt_doc.dart';
import 'escpos.dart';

/// A [ReceiptDoc] as plain ESC/POS text commands.
///
/// A few hundred bytes instead of a ~60 KB bitmap, so there is nothing for a
/// small printer's buffer to overflow and a Bluetooth link to drop: the printer
/// draws its own built-in font. Only ASCII is carried (see [ReceiptDoc.isAscii]).
///
/// No `ESC @` reset: some printers blank or swallow what follows it. Bold,
/// size and alignment are each put back after the line that changed them.
class EscPosText {
  EscPosText._();

  static const _lf = 0x0A;

  /// Feed to just past the blade, then cut. Printers with no cutter ignore it.
  static const feedAndCut = [0x1D, 0x56, 0x41, 0x10];

  static Uint8List encode(ReceiptDoc doc, {required int cols, int? dots, bool cut = true}) {
    final out = BytesBuilder();

    void raw(List<int> b) => out.add(b);
    void text(String s) {
      out.add(s.codeUnits.map((c) => c >= 32 && c < 127 ? c : 0x3F).toList());
      out.addByte(_lf);
    }

    void align(int n) => raw([0x1B, 0x61, n]); // 0 left, 1 centre, 2 right
    void bold(bool on) => raw([0x1B, 0x45, on ? 1 : 0]);
    void size(int n) => raw([0x1D, 0x21, n]); // 0x11 = double width and height

    final logo = doc.logo;
    if (logo != null && dots != null) {
      out.add(EscPos.centred(logo.width, logo.height, logo.rgba, dots));
      text('');
    }

    for (final l in doc.textLines) {
      switch (l) {
        case RText():
          // Double size halves the characters per line; only use it if the text fits.
          final big = l.size == RSize.big && l.text.length <= cols ~/ 2;
          align(l.center ? 1 : 0);
          bold(l.bold || l.size == RSize.big);
          if (big) size(0x11);
          for (final s in wrap(l.text, big ? cols ~/ 2 : cols)) {
            text(s);
          }
          if (big) size(0);
          bold(false);
          align(0);
        case RRow():
          final big = l.big;
          final w = big ? cols ~/ 2 : cols;
          bold(l.bold);
          if (big) size(0x11);
          for (final s in twoCol(l.left, l.right, w)) {
            text(s);
          }
          if (big) size(0);
          bold(false);
        case RItem():
          bold(true);
          for (final s in wrap(l.name, cols)) {
            text(s);
          }
          bold(false);
          for (final s in twoCol(l.qtyRate ?? '', l.amount, cols)) {
            text(s);
          }
        case RNote():
          for (final s in wrap(l.text, cols - 2)) {
            text('  $s');
          }
        case RRule():
          text((l.strong ? '=' : '-') * cols);
        case RGap():
          text('');
        case RTable():
          break; // already written out as lines by textLines
      }
    }

    raw([0x1B, 0x64, 3]); // ESC d 3 — feed three lines
    if (cut) raw(feedAndCut);
    return out.toBytes();
  }

  /// Word-wrap to [width]; a word longer than a line is split.
  static List<String> wrap(String text, int width) {
    if (width < 1) return [text];
    final lines = <String>[];
    var cur = '';
    for (final word in text.trim().split(RegExp(r'\s+'))) {
      var w = word;
      while (w.length > width) {
        if (cur.isNotEmpty) {
          lines.add(cur);
          cur = '';
        }
        lines.add(w.substring(0, width));
        w = w.substring(width);
      }
      if (cur.isEmpty) {
        cur = w;
      } else if (cur.length + 1 + w.length <= width) {
        cur = '$cur $w';
      } else {
        lines.add(cur);
        cur = w;
      }
    }
    if (cur.isNotEmpty || lines.isEmpty) lines.add(cur);
    return lines;
  }

  /// [left] and [right] on one line of [width] characters, right-aligned; a
  /// left side too long for the line wraps, with [right] on the first line.
  static List<String> twoCol(String left, String right, int width) {
    if (right.length >= width - 4) return [...wrap(left, width), right.padLeft(width)];
    final room = width - right.length - 1;
    final parts = wrap(left, room);
    return [
      parts.first.padRight(width - right.length) + right,
      ...parts.skip(1),
    ];
  }
}
