import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/bar.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';

/// The bar bill, as a one-page A6 slip. Plain "Rs." because the PDF's built-in
/// font has no rupee sign.
class BarBillPdf {
  static String _rs(num v) => 'Rs. ${v.toStringAsFixed(2)}';

  static const _pay = {'CASH': 'Cash', 'UPI': 'UPI', 'CARD': 'Card'};

  static Future<Uint8List> build(BarBill b, {required String lodgeName}) async {
    final doc = pw.Document();
    pw.Widget row(String l, String r, {bool bold = false}) => pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
      child: pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: [
          pw.Expanded(child: pw.Text(l, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : null))),
          pw.Text(r, style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : null)),
        ],
      ),
    );
    final lines = [...b.items, ...b.foodItems];
    doc.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a6,
        margin: const pw.EdgeInsets.all(18),
        build: (_) => pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            pw.Center(child: pw.Text(lodgeName, style: pw.TextStyle(fontSize: 14, fontWeight: pw.FontWeight.bold))),
            pw.Center(child: pw.Text('Bar bill', style: const pw.TextStyle(fontSize: 10))),
            pw.SizedBox(height: 6),
            row('Bill no. ${b.billNumber}', (b.billDate ?? '').split('T').first),
            if ((b.customerName ?? '').isNotEmpty) row('Customer', b.customerName!),
            pw.Divider(),
            for (final l in lines)
              row('${l.name}${l.size.isEmpty ? '' : ' (${l.size})'} x ${l.quantity}', _rs(l.lineTotal)),
            pw.Divider(),
            if (b.drinksSubtotal > 0) row('Drinks (incl. ${b.taxPercent.toStringAsFixed(0)}% tax ${_rs(b.taxAmount)})', _rs(b.drinksSubtotal)),
            if (b.foodSubtotal > 0) row('Food${b.foodTaxAmount > 0 ? ' (incl. GST ${_rs(b.foodTaxAmount)})' : ''}', _rs(b.foodSubtotal)),
            if (b.discountAmount > 0) row('Discount', '- ${_rs(b.discountAmount)}'),
            row('Total', _rs(b.total), bold: true),
            pw.SizedBox(height: 6),
            for (final p in b.payments) row('Paid by ${_pay[p.method] ?? p.method}${(p.reference ?? '').isEmpty ? '' : ' (${p.reference})'}', _rs(p.amount)),
            pw.Spacer(),
            pw.Center(child: pw.Text('Thank you. Please visit again.', style: const pw.TextStyle(fontSize: 8))),
          ],
        ),
      ),
    );
    return doc.save();
  }

  static String _file(BarBill b) => 'bar-bill-${b.billNumber.replaceAll(RegExp(r'[\\/]'), '-')}.pdf';

  static Future<void> print(BarBill b, String lodgeName) async {
    final bytes = await build(b, lodgeName: lodgeName);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static Future<void> share(BarBill b, String lodgeName) async =>
      shareBytesFromDevice(await build(b, lodgeName: lodgeName), _file(b));

  static Future<String> download(BarBill b, String lodgeName) async =>
      saveBytesToDevice(await build(b, lodgeName: lodgeName), _file(b));
}
