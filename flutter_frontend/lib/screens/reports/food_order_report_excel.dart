import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import 'report_pdf_style.dart';

/// The food orders register as a real .xlsx.
class FoodOrderReportExcel {
  static Future<void> download(FoodOrdersReport report) async {
    final bytes = build(report);
    await saveBytesToDevice(bytes, _filename(report));
  }

  static String _filename(FoodOrdersReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Food-orders-report-$period.xlsx';
  }

  static Uint8List build(FoodOrdersReport report) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();
    final sheet = excel['Food orders'];
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);
    final s = report.summary;

    xl.TextCellValue t(String v) => xl.TextCellValue(v);
    xl.DoubleCellValue m(num n) => xl.DoubleCellValue(n.toDouble());
    xl.IntCellValue i(int n) => xl.IntCellValue(n);

    void bold(List<xl.CellValue?> row) {
      sheet.appendRow(row);
      final r = sheet.maxRows - 1;
      for (var c = 0; c < row.length; c++) {
        sheet
            .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: r))
            .cellStyle = xl.CellStyle(bold: true);
      }
    }

    bold([t(report.lodgeName.isEmpty ? 'Food orders report' : report.lodgeName)]);
    sheet.appendRow([t('Food orders report'), t(period)]);
    sheet.appendRow([]);
    sheet.appendRow([t('Orders'), i(s.totalOrders)]);
    sheet.appendRow([t('Delivered'), i(s.deliveredCount)]);
    sheet.appendRow([t('Cancelled'), i(s.cancelledCount)]);
    sheet.appendRow([t('Billed value'), m(s.billedValue)]);
    sheet.appendRow([]);

    bold([
      t('Order'), t('Placed'), t('Source'), t('Place'), t('Guest'), t('Items'), t('Status'), t('Bill no.'),
      t('Amount'),
    ]);
    num total = 0;
    for (final o in report.orders) {
      total += o.subtotal;
      sheet.appendRow([
        t('#${o.orderNumber}'),
        t(o.placedAt),
        t(kOrderSourceLabel[o.source] ?? o.source),
        t(o.roomNumber ?? o.tableLabel ?? ''),
        t(o.guestName ?? ''),
        i(o.itemCount),
        t(kOrderStatusLabel[o.status] ?? o.status),
        t(o.invoiceNumber ?? ''),
        m(o.subtotal),
      ]);
    }
    bold([
      t('Total'), t(''), t(''), t(''), t(''), i(report.orders.length), t(''), t(''), m(total),
    ]);

    if (defaultSheet != null && defaultSheet != 'Food orders') excel.delete(defaultSheet);

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }
}
