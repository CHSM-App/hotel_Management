import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/income.dart';
import '../bookings/receipt_download.dart';
import 'income_report_pdf.dart';
import 'report_pdf_style.dart';

/// The other-income register as a real .xlsx — the native equivalent of
/// frontend/src/pages/lodge/incomeReportFile.js's downloadIncomeReportExcel():
/// a "Summary" sheet with the totals [IncomeReportPdf]'s tiles and tables
/// print, and an "Income" sheet with one row per entry plus a footed totals
/// row.
class IncomeReportExcel {
  static Future<String> download(List<IncomeEntry> income, {String? lodgeName}) async {
    final bytes = build(income, lodgeName: lodgeName);
    return saveBytesToDevice(bytes, IncomeReportPdf.filenameFor('xlsx'));
  }

  static Uint8List build(List<IncomeEntry> income, {String? lodgeName}) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();

    _summarySheet(excel, income, lodgeName: lodgeName);
    _incomeSheet(excel, income);

    if (defaultSheet != null && defaultSheet != 'Summary' && defaultSheet != 'Income') {
      excel.delete(defaultSheet);
    }

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }

  static void _summarySheet(xl.Excel excel, List<IncomeEntry> income, {String? lodgeName}) {
    final sheet = excel['Summary'];
    final totals = computeIncomeTotals(income);
    final byCategory = groupIncomeByCategory(income);
    final byPayer = groupIncomeByPayer(income);

    xl.TextCellValue t(String s) => xl.TextCellValue(s);
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

    bold([t(lodgeName?.isNotEmpty == true ? lodgeName! : 'Income report')]);
    sheet.appendRow([t('Generated'), t(ReportPdfStyle.dateTime(DateTime.now()))]);
    sheet.appendRow([]);

    sheet.appendRow([t('Entries logged'), i(totals.count)]);
    sheet.appendRow([t('Total income'), m(totals.total)]);
    sheet.appendRow([t('Received so far'), m(totals.received)]);
    sheet.appendRow([t('Outstanding'), m(totals.outstanding)]);
    sheet.appendRow([]);

    bold([t('By status'), t('Amount')]);
    for (final status in const ['PAID', 'PARTIAL', 'PENDING']) {
      sheet.appendRow([
        t(status == 'PAID' ? 'Received' : (kIncomeStatusLabel[status] ?? 'Received')),
        m(totals.byStatus[status] ?? 0),
      ]);
    }
    sheet.appendRow([]);

    bold([t('By category'), t('Amount'), t('Entries')]);
    for (final g in byCategory) {
      sheet.appendRow([t(g.label), m(g.total), i(g.count)]);
    }
    sheet.appendRow([]);

    bold([t('By payer'), t('Amount'), t('Entries')]);
    for (final g in byPayer) {
      sheet.appendRow([t(g.label), m(g.total), i(g.count)]);
    }
  }

  static void _incomeSheet(xl.Excel excel, List<IncomeEntry> income) {
    final sheet = excel['Income'];
    const headers = ['Date', 'Title', 'Category', 'Payer', 'Amount', 'Received via', 'Status', 'Received so far'];
    sheet.appendRow([for (final h in headers) xl.TextCellValue(h)]);
    final headerRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: headerRow))
          .cellStyle = xl.CellStyle(bold: true);
    }

    for (final e in income) {
      sheet.appendRow([
        xl.TextCellValue(ReportPdfStyle.dateOnly(e.incomeDate)),
        xl.TextCellValue(e.title),
        xl.TextCellValue(e.categoryName),
        xl.TextCellValue(e.payerName ?? ''),
        xl.DoubleCellValue(e.amount.toDouble()),
        xl.TextCellValue(kPaymentMethodLabel[e.paymentMethod] ?? e.paymentMethod),
        xl.TextCellValue(e.paymentStatus == 'PAID' ? 'Received' : (kIncomeStatusLabel[e.paymentStatus] ?? 'Received')),
        xl.DoubleCellValue((e.amountReceived ?? 0).toDouble()),
      ]);
    }

    final totals = computeIncomeTotals(income);
    sheet.appendRow([
      xl.TextCellValue('Total'),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.DoubleCellValue(totals.total.toDouble()),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.DoubleCellValue(totals.received.toDouble()),
    ]);
    final totalsRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: totalsRow))
          .cellStyle = xl.CellStyle(bold: true);
    }
  }
}
