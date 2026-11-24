import 'dart:typed_data';

/// Turns a rendered receipt (RGBA pixels) into ESC/POS bytes: a 1-bit raster
/// image printed in bands, a paper feed, and optionally a cut.
///
/// A bitmap rather than text commands so the PDF layout, the rupee sign and any
/// script print exactly as drawn, on any ESC/POS printer with no code pages.
class EscPos {
  EscPos._();

  /// Rows per `GS v 0` command: complete commands back to back, ~256 dots
  /// each, so a small printer's buffer is never asked to hold the whole image.
  static const bandRows = 64;

  static Uint8List raster(
    int width,
    int height,
    Uint8List rgba, {
    int threshold = 160,
    bool cut = true,
    int feedLines = 3,
  }) {
    final out = BytesBuilder();
    out.add([0x1B, 0x40]); // ESC @ — initialise
    out.add(bands(width, height, rgba, threshold: threshold));
    if (feedLines > 0) out.add([0x1B, 0x64, feedLines]); // ESC d n — feed
    if (cut) out.add([0x1D, 0x56, 0x42, 0x00]); // GS V 66 0 — feed to cut, partial
    return out.toBytes();
  }

  /// A small image centred on a line [dots] wide: padded with paper on both
  /// sides rather than relying on the printer to align a raster image.
  static Uint8List centred(int width, int height, Uint8List rgba, int dots, {int threshold = 128}) {
    if (width >= dots) return bands(width, height, rgba, threshold: threshold);
    final canvas = Uint8List(dots * height * 4)..fillRange(0, dots * height * 4, 255);
    final left = (dots - width) ~/ 2;
    for (var y = 0; y < height; y++) {
      canvas.setRange((y * dots + left) * 4, (y * dots + left + width) * 4, rgba, y * width * 4);
    }
    return bands(dots, height, canvas, threshold: threshold);
  }

  /// Just the `GS v 0` bands for an image — no reset, feed or cut.
  static Uint8List bands(int width, int height, Uint8List rgba, {int threshold = 160}) {
    final bytesPerRow = (width + 7) ~/ 8;
    final out = BytesBuilder();

    for (var y0 = 0; y0 < height; y0 += bandRows) {
      final rows = (y0 + bandRows <= height) ? bandRows : height - y0;
      // GS v 0 m xL xH yL yH d1..dk
      out.add([
        0x1D, 0x76, 0x30, 0x00,
        bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
        rows & 0xFF, (rows >> 8) & 0xFF,
      ]);
      final band = Uint8List(bytesPerRow * rows);
      for (var r = 0; r < rows; r++) {
        final y = y0 + r;
        for (var x = 0; x < width; x++) {
          final i = (y * width + x) * 4;
          final a = rgba[i + 3];
          // Luma of the pixel over white; transparent counts as paper.
          final luma = a < 128
              ? 255
              : (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) ~/ 1000;
          if (luma < threshold) {
            band[r * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
          }
        }
      }
      out.add(band);
    }
    return out.toBytes();
  }
}
