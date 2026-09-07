/// Saving a receipt straight to the device, distinct from [Printing.sharePdf]
/// (which on a browser with no share target of its own just downloads the
/// file too, making "Share" and "Download" look identical) and from
/// [Printing.layoutPdf] (the print dialog).
///
/// `dart:io` has no filesystem to write to on the web, and `package:web`'s
/// Blob-and-anchor trick does not exist off it — so which one actually runs
/// is chosen per platform at compile time.
library;

export 'receipt_download_io.dart'
    if (dart.library.html) 'receipt_download_web.dart';
