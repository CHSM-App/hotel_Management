import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../../domain/models/bar.dart';
import '../bookings/receipt_download.dart';

String _rs(num v) => 'Rs. ${v.toStringAsFixed(2)}';

/// The bar report as a PDF (overview, then Sales / Stock / Bills tables).
class BarReportPdf {
  static Future<String> download(BarReport r, {String? lodgeName}) async =>
      saveBytesToDevice(await build(r, lodgeName: lodgeName), 'Bar-report-${r.sales.from}-to-${r.sales.to}.pdf');

  static Future<Uint8List> build(BarReport r, {String? lodgeName}) async {
    final s = r.sales;
    final doc = pw.Document();
    pw.Widget table(List<String> head, List<List<String>> rows) => pw.TableHelper.fromTextArray(
      headers: head,
      data: rows,
      headerStyle: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold),
      cellStyle: const pw.TextStyle(fontSize: 9),
      headerDecoration: const pw.BoxDecoration(color: PdfColors.grey300),
    );
    pw.Widget h(String t) => pw.Padding(
      padding: const pw.EdgeInsets.only(top: 12, bottom: 4),
      child: pw.Text(t, style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold)),
    );
    doc.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(28),
        build: (_) => [
          pw.Text('${lodgeName ?? ''} - Bar report', style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold)),
          pw.Text('${s.from} to ${s.to}', style: const pw.TextStyle(fontSize: 10)),
          h('Overview'),
          table(['Total sales', 'Bills', 'Drinks', 'Food', 'Drinks tax', 'On room bills'], [
            [_rs(s.total), '${s.bills}', _rs(s.drinks), _rs(s.food), _rs(s.tax), _rs(s.roomTotal)],
          ]),
          if (s.byPayment.isNotEmpty) ...[h('Payments'), table(['Method', 'Amount'], [for (final e in s.byPayment.entries) [e.key, _rs(e.value)]])],
          if (s.byCategory.isNotEmpty) ...[h('By category'), table(['Category', 'ml', 'Amount'], [for (final c in s.byCategory) [c.category, '${c.ml}', _rs(c.amount)]])],
          if (s.byItem.isNotEmpty) ...[h('Items sold'), table(['Item', 'Size', 'Qty', 'Amount'], [for (final i in s.byItem) [i.name, i.size, '${i.quantity}', _rs(i.amount)]])],
          if (r.stock.isNotEmpty) ...[
            h('Stock'),
            table(['Product', 'Opening', 'In', 'Sold', 'Wastage', 'Closing'], [for (final p in r.stock) [p.name, p.opening.text, p.purchased.text, p.sold.text, p.wastage.text, p.closing.text]]),
          ],
          if (r.bills.isNotEmpty) ...[h('Bills'), table(['Bill', 'Date', 'Customer', 'Total'], [for (final b in r.bills) [b.billNumber, (b.billDate ?? '').split('T').first, b.customerName ?? '', _rs(b.total)]])],
        ],
      ),
    );
    return doc.save();
  }
}

/// The bar report as an .xlsx: Summary, Items, Stock and Bills sheets.
class BarReportExcel {
  static Future<String> download(BarReport r, {String? lodgeName}) async =>
      saveBytesToDevice(build(r), 'Bar-report-${r.sales.from}-to-${r.sales.to}.xlsx');

  static Uint8List build(BarReport r) {
    final s = r.sales;
    final excel = xl.Excel.createExcel();
    final first = excel.getDefaultSheet();
    xl.CellValue t(String v) => xl.TextCellValue(v);
    xl.CellValue n(num v) => xl.DoubleCellValue(v.toDouble());

    final sum = excel['Summary'];
    sum.appendRow([t('Period'), t('${s.from} to ${s.to}')]);
    for (final e in {'Total sales': s.total, 'Bills': s.bills, 'Drinks': s.drinks, 'Food': s.food, 'Drinks tax': s.tax, 'Food GST': s.foodTax, 'On room bills': s.roomTotal}.entries) {
      sum.appendRow([t(e.key), n(e.value)]);
    }
    for (final e in s.byPayment.entries) {
      sum.appendRow([t('Paid by ${e.key}'), n(e.value)]);
    }
    final items = excel['Items'];
    items.appendRow([t('Item'), t('Size'), t('Kind'), t('Qty'), t('ml'), t('Amount')]);
    for (final i in s.byItem) {
      items.appendRow([t(i.name), t(i.size), t(i.kind), n(i.quantity), n(i.ml), n(i.amount)]);
    }
    final stock = excel['Stock'];
    stock.appendRow([t('Product'), t('Opening'), t('In'), t('Sold'), t('Wastage'), t('Adjustment'), t('Closing'), t('Now')]);
    for (final p in r.stock) {
      stock.appendRow([t(p.name), t(p.opening.text), t(p.purchased.text), t(p.sold.text), t(p.wastage.text), t(p.adjustment.text), t(p.closing.text), t(p.current.text)]);
    }
    final bills = excel['Bills'];
    bills.appendRow([t('Bill'), t('Date'), t('Customer'), t('Total')]);
    for (final b in r.bills) {
      bills.appendRow([t(b.billNumber), t((b.billDate ?? '').split('T').first), t(b.customerName ?? ''), n(b.total)]);
    }
    if (first != null) excel.delete(first);
    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }
}
