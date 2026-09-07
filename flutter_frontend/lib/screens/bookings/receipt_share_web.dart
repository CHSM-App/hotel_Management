import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

import 'receipt_download_web.dart' show saveBytesToDevice;

/// The real OS share sheet, where the browser actually has one to hand a
/// file to — [Printing.sharePdf] never attempts this on the web at all; it
/// downloads the file the same way [saveBytesToDevice] does regardless of
/// what the browser can actually do, which is why Share and Download read as
/// the same button there.
///
/// `canShare` is asked first and trusted: most desktop browsers report no
/// support for sharing files at all, and this falls back to the same
/// download the button next to it already offers rather than calling
/// `share()` anyway and failing. Once support is confirmed, a share the desk
/// then backs out of is left alone — the promise rejects with an
/// `AbortError` for that, which is the browser's own cancel, not a failure
/// to report.
Future<void> shareBytesFromDevice(Uint8List bytes, String filename) async {
  final file = web.File(
    [bytes.toJS].toJS,
    filename,
    web.FilePropertyBag(type: 'application/pdf'),
  );
  final data = web.ShareData(files: [file].toJS);

  final navigator = web.window.navigator;
  final supported = navigator.canShare(data);
  if (!supported) {
    await saveBytesToDevice(bytes, filename);
    return;
  }

  try {
    await navigator.share(data).toDart;
  } catch (_) {
    // A cancelled share (AbortError) is the desk changing its mind, not a
    // failure — nothing to fall back to.
  }
}
