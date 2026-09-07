/// The real share sheet, distinct from a plain download. Off the web,
/// `Printing.sharePdf` already does this correctly; on the web it never
/// attempts the browser's own share API at all and just downloads the file
/// instead, which is what made Share and Download look identical there —
/// this reaches for the real thing.
library;

export 'receipt_share_io.dart'
    if (dart.library.html) 'receipt_share_web.dart';
