import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import 'report_pdf_style.dart';

const _kOrderStatuses = ['PENDING', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];
const _kOrderSources = ['ROOM', 'TABLE', 'COUNTER'];

/// The food orders register as a real .xlsx — the native equivalent of
/// frontend/src/pages/lodge/foodOrderReportFile.js's
/// downloadFoodOrdersReportExcel(): a "Summary" sheet with the same sections
/// [FoodOrderReportPdf] prints, and an "Orders" sheet with one row per order
/// plus a footed totals row.
class FoodOrderReportExcel {
  static Future<String> download(FoodOrdersReport report) async {
    final bytes = build(report);
    return saveBytesToDevice(bytes, _filename(report));
  }

  static String _filename(FoodOrdersReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Food-orders-report-$period.xlsx';
  }

  static Uint8List build(FoodOrdersReport report) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();

    _summarySheet(excel, report);
    _ordersSheet(excel, report);

    if (defaultSheet != null && defaultSheet != 'Summary' && defaultSheet != 'Orders') {
      excel.delete(defaultSheet);
    }

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }

  static void _summarySheet(xl.Excel excel, FoodOrdersReport report) {
    final sheet = excel['Summary'];
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
    sheet.appendRow([t('Generated'), t(ReportPdfStyle.dateTime(DateTime.tryParse(report.generatedAt ?? '') ?? DateTime.now()))]);
    sheet.appendRow([]);
    sheet.appendRow([
      t(
        'An order is counted on the calendar day it was placed on. Delivered and cancelled orders are both '
        'counted; a live order still in the kitchen queue when this report is pulled counts too, under '
        'whatever status it is currently in.',
      ),
    ]);
    sheet.appendRow([]);

    bold([t('ORDERS PLACED IN ${period.toUpperCase()}')]);
    sheet.appendRow([t('Total orders'), i(s.totalOrders)]);
    for (final status in _kOrderStatuses) {
      sheet.appendRow([t('  ${kOrderStatusLabel[status] ?? status}'), i(s.statusCount(status))]);
    }
    sheet.appendRow([]);

    bold([t('By source'), t('Count')]);
    for (final source in _kOrderSources) {
      sheet.appendRow([t(kOrderSourceLabel[source] ?? source), i(s.bySource[source] ?? 0)]);
    }
    sheet.appendRow([]);

    bold([t('VALUE')]);
    sheet.appendRow([t('Delivered - count'), i(s.deliveredCount)]);
    sheet.appendRow([t('Delivered - value'), m(s.deliveredValue)]);
    sheet.appendRow([t('Billed - count'), i(s.billedCount)]);
    sheet.appendRow([t('Billed - value'), m(s.billedValue)]);
    sheet.appendRow([t('Delivered but not yet billed'), m(s.unbilledDeliveredValue)]);
    sheet.appendRow([t('Cancelled - count'), i(s.cancelledCount)]);
  }

  static void _ordersSheet(xl.Excel excel, FoodOrdersReport report) {
    final sheet = excel['Orders'];
    const headers = [
      'Order no.', 'Placed at', 'Source', 'Room/Table', 'Guest', 'Phone', 'Items', 'Status',
      'Delivered at', 'Cancelled at', 'Bill no.', 'Document', 'Amount',
    ];
    sheet.appendRow([for (final h in headers) xl.TextCellValue(h)]);
    final headerRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: headerRow))
          .cellStyle = xl.CellStyle(bold: true);
    }

    num total = 0;
    for (final o in report.orders) {
      if (o.status != 'CANCELLED') total += o.subtotal;
      sheet.appendRow([
        xl.TextCellValue('#${o.orderNumber}'),
        xl.TextCellValue(ReportPdfStyle.dateTime(DateTime.tryParse(o.placedAt) ?? DateTime.now())),
        xl.TextCellValue(kOrderSourceLabel[o.source] ?? o.source),
        xl.TextCellValue(o.roomNumber ?? o.tableLabel ?? '—'),
        xl.TextCellValue(o.guestName ?? ''),
        xl.TextCellValue(o.guestPhone ?? ''),
        xl.IntCellValue(o.itemCount),
        xl.TextCellValue(kOrderStatusLabel[o.status] ?? o.status),
        xl.TextCellValue(o.deliveredAt == null ? '' : ReportPdfStyle.dateTime(DateTime.tryParse(o.deliveredAt!) ?? DateTime.now())),
        xl.TextCellValue(o.cancelledAt == null ? '' : ReportPdfStyle.dateTime(DateTime.tryParse(o.cancelledAt!) ?? DateTime.now())),
        xl.TextCellValue(o.invoiceNumber ?? ''),
        xl.TextCellValue(o.documentType ?? ''),
        xl.DoubleCellValue(o.subtotal.toDouble()),
      ]);
    }

    // Cancelled orders are listed for the record but never billed, so their
    // subtotal is excluded from the footed total — mirrors the web's totals
    // reduce, which also skips o.status === 'CANCELLED'.
    sheet.appendRow([
      xl.TextCellValue('Total'), xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''),
      xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''),
      xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''),
      xl.DoubleCellValue(total.toDouble()),
    ]);
    final totalsRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: totalsRow))
          .cellStyle = xl.CellStyle(bold: true);
    }
  }
}
