import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import 'report_pdf_style.dart';

/// Same words the screen uses for a usage's status — mirrors statusLabel()
/// in servicesReportFile.js.
String _statusLabel(ServiceUsageRow u) {
  if (u.voided) return 'Voided';
  if (u.status == 'CANCELLED') return 'Cancelled';
  if (u.status == 'IN_USE') return 'In use';
  if (u.status == 'COMPLETED') return 'Completed';
  return u.status;
}

String _billedOn(ServiceUsageRow u) => u.invoiceNumber ?? (u.onRoomBill ? 'Room bill' : '—');

/// The Other services report as a real .xlsx — the native equivalent of
/// frontend/src/pages/lodge/servicesReportFile.js's
/// downloadServicesReportExcel(): a "Summary" sheet, a "By service" sheet and
/// an "Every use" sheet, each footed the same way the PDF is.
class ServicesReportExcel {
  static Future<String> download(ServicesReport report, {String? lodgeName}) async {
    final bytes = build(report, lodgeName: lodgeName);
    return saveBytesToDevice(bytes, _filename(report));
  }

  static String _filename(ServicesReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Other-services-report-$period.xlsx';
  }

  static Uint8List build(ServicesReport report, {String? lodgeName}) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();

    _summarySheet(excel, report, lodgeName);
    _byServiceSheet(excel, report);
    _usagesSheet(excel, report);

    if (defaultSheet != null && defaultSheet != 'Summary' && defaultSheet != 'By service' && defaultSheet != 'Every use') {
      excel.delete(defaultSheet);
    }

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }

  static void _bold(xl.Sheet sheet, List<xl.CellValue?> row) {
    sheet.appendRow(row);
    final r = sheet.maxRows - 1;
    for (var c = 0; c < row.length; c++) {
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: r)).cellStyle = xl.CellStyle(bold: true);
    }
  }

  static void _summarySheet(xl.Excel excel, ServicesReport report, String? lodgeName) {
    final sheet = excel['Summary'];
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);
    final t = report.totals;
    final name = (lodgeName?.isNotEmpty ?? false) ? lodgeName! : 'Other services report';

    xl.TextCellValue text(String v) => xl.TextCellValue(v);
    xl.DoubleCellValue money(num n) => xl.DoubleCellValue(n.toDouble());
    xl.IntCellValue count(int n) => xl.IntCellValue(n);

    _bold(sheet, [text(name)]);
    sheet.appendRow([text('Other services report'), text(period)]);
    sheet.appendRow([text('Generated'), text(ReportPdfStyle.dateTime(DateTime.now()))]);
    sheet.appendRow([]);
    sheet.appendRow([
      text(
        'A use is counted on the calendar day it started. Cancelled uses and voided bills are listed below but '
        'excluded from the totals here — the value they would have added is never counted.',
      ),
    ]);
    sheet.appendRow([]);

    _bold(sheet, [text('USES IN ${period.toUpperCase()}')]);
    sheet.appendRow([text('Total uses'), count(t.count)]);
    sheet.appendRow([text('Cancelled'), count(t.cancelledCount)]);
    sheet.appendRow([text('Voided bills'), count(t.voidedCount)]);
    sheet.appendRow([]);

    _bold(sheet, [text('VALUE')]);
    sheet.appendRow([text('Billed'), money(t.billedValue)]);
    sheet.appendRow([text('Completed, not yet billed'), money(t.unbilledValue)]);
  }

  static void _byServiceSheet(xl.Excel excel, ServicesReport report) {
    final sheet = excel['By service'];
    const headers = ['Service', 'Uses', 'Quantity', 'Value'];
    sheet.appendRow([for (final h in headers) xl.TextCellValue(h)]);
    final headerRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: headerRow)).cellStyle = xl.CellStyle(bold: true);
    }

    num uses = 0, quantity = 0, value = 0;
    for (final s in report.byService) {
      uses += s.uses;
      quantity += s.quantity;
      value += s.value;
      sheet.appendRow([
        xl.TextCellValue(s.serviceName),
        xl.IntCellValue(s.uses),
        xl.DoubleCellValue(s.quantity.toDouble()),
        xl.DoubleCellValue(s.value.toDouble()),
      ]);
    }

    sheet.appendRow([
      xl.TextCellValue('Total'),
      xl.DoubleCellValue(uses.toDouble()),
      xl.DoubleCellValue(quantity.toDouble()),
      xl.DoubleCellValue(value.toDouble()),
    ]);
    final totalsRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: totalsRow)).cellStyle = xl.CellStyle(bold: true);
    }
  }

  static void _usagesSheet(xl.Excel excel, ServicesReport report) {
    final sheet = excel['Every use'];
    const headers = ['Started', 'Service', 'Quantity', 'Guest', 'Room', 'Status', 'Billed on', 'Amount'];
    sheet.appendRow([for (final h in headers) xl.TextCellValue(h)]);
    final headerRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: headerRow)).cellStyle = xl.CellStyle(bold: true);
    }

    // Cancelled and voided uses are listed for the record but add nothing —
    // matches the summary's billedValue/unbilledValue, which never count them.
    num total = 0;
    for (final u in report.usages) {
      if (u.status != 'CANCELLED' && !u.voided) total += u.lineTotal;
      sheet.appendRow([
        xl.TextCellValue(ReportPdfStyle.dateTime(DateTime.tryParse(u.startedAt) ?? DateTime.now())),
        xl.TextCellValue(u.serviceName),
        xl.DoubleCellValue(u.quantity.toDouble()),
        xl.TextCellValue(u.guestName ?? ''),
        xl.TextCellValue(u.roomNumber ?? ''),
        xl.TextCellValue(_statusLabel(u)),
        xl.TextCellValue(_billedOn(u)),
        xl.DoubleCellValue(u.lineTotal.toDouble()),
      ]);
    }

    sheet.appendRow([
      xl.TextCellValue('Total'), xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''),
      xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''),
      xl.DoubleCellValue(total.toDouble()),
    ]);
    final totalsRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: totalsRow)).cellStyle = xl.CellStyle(bold: true);
    }
  }
}
