import 'dart:typed_data';

import 'package:printing/printing.dart';

/// The native OS share sheet — [Printing.sharePdf] already does this
/// correctly everywhere off the web (Android's share intent, iOS's
/// `UIActivityViewController`, the desktop equivalents), so it is used
/// as-is here.
Future<void> shareBytesFromDevice(Uint8List bytes, String filename) async {
  await Printing.sharePdf(bytes: bytes, filename: filename);
}
