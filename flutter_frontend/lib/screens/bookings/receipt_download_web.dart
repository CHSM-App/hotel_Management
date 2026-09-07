import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

/// A real browser download — a Blob handed straight to a hidden `<a
/// download>` and clicked, rather than [Printing.sharePdf], which on a
/// desktop browser with no share target of its own falls back to whatever
/// the browser does with a share request, not a download in its own right.
///
/// This never opens a save-as prompt or any dialog beyond the browser's own
/// download bar — the same as a real click on a download link. Returns a
/// short description of where it went, since there is no filesystem path to
/// report from inside a browser sandbox.
Future<String> saveBytesToDevice(Uint8List bytes, String filename) async {
  final blob = web.Blob(
    [bytes.toJS].toJS,
    web.BlobPropertyBag(type: 'application/pdf'),
  );
  final url = web.URL.createObjectURL(blob);
  final anchor = web.HTMLAnchorElement()
    ..href = url
    ..download = filename
    ..style.display = 'none';
  web.document.body!.appendChild(anchor);
  anchor.click();
  anchor.remove();
  web.URL.revokeObjectURL(url);
  return 'your browser\'s downloads';
}
