import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import 'report_pdf_style.dart';

/// The events & functions register as a real .xlsx.
class EventReportExcel {
  static Future<void> download(EventsReport report) async {
    final bytes = build(report);
    await saveBytesToDevice(bytes, _filename(report));
  }

  static String _filename(EventsReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Events-report-$period.xlsx';
  }

  static Uint8List build(EventsReport report) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();
    final sheet = excel['Events'];
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

    bold([t(report.lodgeName.isEmpty ? 'Events report' : report.lodgeName)]);
    sheet.appendRow([t('Events & functions report'), t(period)]);
    sheet.appendRow([]);
    sheet.appendRow([t('Functions'), i(s.totalEvents)]);
    sheet.appendRow([t('Settled'), i(s.statusCount('SETTLED'))]);
    sheet.appendRow([t('Confirmed'), i(s.statusCount('CONFIRMED'))]);
    sheet.appendRow([t('Cancelled'), i(s.cancelled.count)]);
    sheet.appendRow([t('Total value'), m(s.totals.totalAmount)]);
    sheet.appendRow([t('Advance held'), m(s.totals.advanceAmount)]);
    sheet.appendRow([]);

    bold([
      t('Bill no.'), t('Function'), t('Type'), t('Organiser'), t('Phone'), t('Venue'), t('Date'),
      t('Pax'), t('Status'), t('Advance'), t('Total'), t('Balance due'),
    ]);
    for (final ev in report.events) {
      sheet.appendRow([
        t(ev.invoiceNumber ?? ''),
        t(ev.title),
        t(kEventTypeLabel[ev.eventType] ?? ev.eventType),
        t(ev.organiserName ?? ''),
        t(ev.organiserPhone ?? ''),
        t(ev.venueName ?? ''),
        t(ev.startAt),
        i(ev.pax),
        t(kEventStatusLabel[ev.status] ?? ev.status),
        m(ev.advanceAmount),
        m(ev.totalAmount),
        m(ev.balanceDue),
      ]);
    }
    bold([
      t('Total'), t(''), t(''), t(''), t(''), t(''), t(''),
      t(''), i(s.totalEvents), m(s.totals.advanceAmount), m(s.totals.totalAmount), m(s.totals.balanceDue),
    ]);

    if (defaultSheet != null && defaultSheet != 'Events') excel.delete(defaultSheet);

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }
}
