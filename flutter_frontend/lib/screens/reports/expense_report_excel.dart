import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/expense.dart';
import '../bookings/receipt_download.dart';
import 'expense_report_pdf.dart';
import 'report_pdf_style.dart';

/// The expense register as a real .xlsx — the native equivalent of
/// frontend/src/pages/lodge/expenseReportFile.js's downloadExpensesReportExcel():
/// a "Summary" sheet with the totals [ExpenseReportPdf]'s tiles and tables
/// print, and an "Expenses" sheet with one row per expense plus a footed
/// totals row.
class ExpenseReportExcel {
  static Future<String> download(List<Expense> expenses, {String? lodgeName}) async {
    final bytes = build(expenses, lodgeName: lodgeName);
    return saveBytesToDevice(bytes, ExpenseReportPdf.filenameFor('xlsx'));
  }

  static Uint8List build(List<Expense> expenses, {String? lodgeName}) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();

    _summarySheet(excel, expenses, lodgeName: lodgeName);
    _expensesSheet(excel, expenses);

    if (defaultSheet != null && defaultSheet != 'Summary' && defaultSheet != 'Expenses') {
      excel.delete(defaultSheet);
    }

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }

  static void _summarySheet(xl.Excel excel, List<Expense> expenses, {String? lodgeName}) {
    final sheet = excel['Summary'];
    final totals = computeExpenseTotals(expenses);
    final byCategory = groupExpensesByCategory(expenses);
    final byVendor = groupExpensesByVendor(expenses);

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

    bold([t(lodgeName?.isNotEmpty == true ? lodgeName! : 'Expense report')]);
    sheet.appendRow([t('Generated'), t(ReportPdfStyle.dateTime(DateTime.now()))]);
    sheet.appendRow([]);

    sheet.appendRow([t('Expenses logged'), i(totals.count)]);
    sheet.appendRow([t('Total spend'), m(totals.total)]);
    sheet.appendRow([t('Paid so far'), m(totals.paid)]);
    sheet.appendRow([t('Outstanding'), m(totals.outstanding)]);
    sheet.appendRow([]);

    bold([t('By status'), t('Amount')]);
    for (final status in const ['PAID', 'PARTIAL', 'PENDING']) {
      sheet.appendRow([
        t(status == 'PAID' ? 'Paid' : (kPaymentStatusLabel[status] ?? 'Paid')),
        m(totals.byStatus[status] ?? 0),
      ]);
    }
    sheet.appendRow([]);

    bold([t('By category'), t('Amount'), t('Expenses')]);
    for (final g in byCategory) {
      sheet.appendRow([t(g.label), m(g.total), i(g.count)]);
    }
    sheet.appendRow([]);

    bold([t('By vendor'), t('Amount'), t('Expenses')]);
    for (final g in byVendor) {
      sheet.appendRow([t(g.label), m(g.total), i(g.count)]);
    }
  }

  static void _expensesSheet(xl.Excel excel, List<Expense> expenses) {
    final sheet = excel['Expenses'];
    const headers = ['Date', 'Title', 'Category', 'Vendor', 'Amount', 'Paid via', 'Status', 'Paid so far'];
    sheet.appendRow([for (final h in headers) xl.TextCellValue(h)]);
    final headerRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: headerRow))
          .cellStyle = xl.CellStyle(bold: true);
    }

    for (final e in expenses) {
      sheet.appendRow([
        xl.TextCellValue(ReportPdfStyle.dateOnly(e.expenseDate)),
        xl.TextCellValue(e.title),
        xl.TextCellValue(e.categoryName),
        xl.TextCellValue(e.vendorName ?? ''),
        xl.DoubleCellValue(e.amount.toDouble()),
        xl.TextCellValue(kPaymentMethodLabel[e.paymentMethod] ?? e.paymentMethod),
        xl.TextCellValue(e.paymentStatus == 'PAID' ? 'Paid' : (kPaymentStatusLabel[e.paymentStatus] ?? 'Paid')),
        xl.DoubleCellValue((e.amountPaid ?? 0).toDouble()),
      ]);
    }

    final totals = computeExpenseTotals(expenses);
    sheet.appendRow([
      xl.TextCellValue('Total'),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.DoubleCellValue(totals.total.toDouble()),
      xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.DoubleCellValue(totals.paid.toDouble()),
    ]);
    final totalsRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: totalsRow))
          .cellStyle = xl.CellStyle(bold: true);
    }
  }
}
