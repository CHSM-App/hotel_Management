import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../domain/models/printer_config.dart';
import '../../domain/models/receipt_doc.dart';

/// Draws a [ReceiptDoc] as a narrow one-column PDF: for the Windows driver, for
/// the on-screen preview, and as the image fallback when text cannot carry the
/// receipt.
class ThermalReceiptPdf {
  ThermalReceiptPdf._();

  static Future<Uint8List> render(ReceiptDoc doc, ReceiptSpec spec) async {
    final k = _Kit(spec);
    final pdf = pw.Document();
    pdf.addPage(
      pw.Page(
        pageFormat: PdfPageFormat(spec.pageWidth, double.infinity, marginAll: spec.margin),
        build: (_) => pw.Column(
          mainAxisSize: pw.MainAxisSize.min,
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            if (doc.logo != null)
              pw.Padding(
                padding: const pw.EdgeInsets.only(bottom: 6),
                child: pw.Center(
                  child: pw.Image(
                    pw.RawImage(bytes: doc.logo!.rgba, width: doc.logo!.width, height: doc.logo!.height),
                    width: doc.logo!.width * 72 / 203,
                    height: doc.logo!.height * 72 / 203,
                  ),
                ),
              ),
            for (final l in doc.textLines) k.draw(l),
          ],
        ),
      ),
    );
    return pdf.save();
  }

  /// A picture of a receipt (see ReceiptRaster) as a one-page PDF, sized so one
  /// image pixel is one printer dot (203 dpi), centred on the roll.
  static Future<Uint8List> renderImage(({Uint8List png, int width, int height}) pic, ReceiptSpec spec) async {
    final w = pic.width * 72 / 203;
    final h = pic.height * 72 / 203;
    final pdf = pw.Document();
    pdf.addPage(
      pw.Page(
        pageFormat: PdfPageFormat(spec.pageWidth, h + 2 * spec.margin, marginAll: spec.margin),
        build: (_) => pw.Center(child: pw.Image(pw.MemoryImage(pic.png), width: w, height: h)),
      ),
    );
    return pdf.save();
  }
}

class _Kit {
  final ReceiptSpec spec;
  _Kit(this.spec);

  double get _f => spec.font;

  pw.Widget draw(RLine l) => switch (l) {
    RText() => text(l),
    RRow() => row(l.left, l.right, bold: l.bold, big: l.big),
    RItem() => item(l),
    RNote() => pw.Padding(padding: const pw.EdgeInsets.only(left: 8), child: pw.Text(l.text, style: pw.TextStyle(fontSize: _f - 1.5))),
    RRule() => rule(l.strong),
    RGap() => pw.SizedBox(height: 5),
    RTable() => pw.SizedBox(),
  };

  pw.Widget text(RText t) => pw.Padding(
    padding: const pw.EdgeInsets.symmetric(vertical: 1),
    child: pw.Text(
      t.text,
      textAlign: t.center ? pw.TextAlign.center : pw.TextAlign.left,
      style: pw.TextStyle(
        fontSize: switch (t.size) {
          RSize.big => _f + 3,
          RSize.small => _f - 1.5,
          RSize.normal => _f,
        },
        fontWeight: (t.bold || t.size == RSize.big) ? pw.FontWeight.bold : null,
      ),
    ),
  );

  pw.Widget rule(bool strong) => pw.Padding(
    padding: const pw.EdgeInsets.symmetric(vertical: 3),
    child: pw.Divider(
      height: 1,
      thickness: strong ? 1.1 : 0.6,
      borderStyle: strong ? pw.BorderStyle.solid : pw.BorderStyle.dashed,
    ),
  );

  pw.Widget row(String l, String r, {bool bold = false, bool big = false}) {
    final style = pw.TextStyle(fontSize: big ? _f + 1.5 : _f, fontWeight: bold ? pw.FontWeight.bold : null);
    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 1),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Expanded(child: pw.Text(l, style: style)),
          pw.SizedBox(width: 6),
          pw.Text(r, style: style),
        ],
      ),
    );
  }

  pw.Widget item(RItem i) => pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.stretch,
    children: [
      pw.Padding(
        padding: const pw.EdgeInsets.only(top: 2),
        child: pw.Text(i.name, style: pw.TextStyle(fontSize: _f, fontWeight: pw.FontWeight.bold)),
      ),
      pw.Row(
        children: [
          pw.Expanded(child: pw.Text(i.qtyRate ?? '', style: pw.TextStyle(fontSize: _f - 0.5))),
          pw.Text(i.amount, style: pw.TextStyle(fontSize: _f)),
        ],
      ),
    ],
  );
}
