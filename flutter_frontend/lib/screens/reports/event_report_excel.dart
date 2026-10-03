import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import 'report_pdf_style.dart';

/// The events & functions register as a real .xlsx — the native equivalent
/// of frontend/src/pages/lodge/eventReportFile.js's downloadEventsReportExcel():
/// a "Summary" sheet with the same sections [EventReportPdf] prints, and a
/// "Functions" sheet with one row per function plus a footed totals row.
class EventReportExcel {
  static Future<String> download(EventsReport report) async {
    final bytes = build(report);
    return saveBytesToDevice(bytes, _filename(report));
  }

  static String _filename(EventsReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Events-report-$period.xlsx';
  }

  static Uint8List build(EventsReport report) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();

    _summarySheet(excel, report);
    _functionsSheet(excel, report);

    if (defaultSheet != null && defaultSheet != 'Summary' && defaultSheet != 'Functions') {
      excel.delete(defaultSheet);
    }

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }

  static void _summarySheet(xl.Excel excel, EventsReport report) {
    final sheet = excel['Summary'];
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);
    final s = report.summary;
    final totals = s.totals;
    final cancelled = s.cancelled;

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

    bold([t(report.lodgeName.isEmpty ? 'Events & functions report' : report.lodgeName)]);
    sheet.appendRow([t('Events & functions report'), t(period)]);
    sheet.appendRow([t('Generated'), t(ReportPdfStyle.dateTime(DateTime.tryParse(report.generatedAt ?? '') ?? DateTime.now()))]);
    sheet.appendRow([]);
    sheet.appendRow([
      t(
        'Functions are counted by the day they start. A function running past midnight is counted once, on the '
        'evening it begins. Cancelled and expired functions are listed for the record but excluded from every '
        'money figure, except cancellation charges kept, which are shown separately.',
      ),
    ]);
    sheet.appendRow([]);

    bold([t('FUNCTIONS STARTING IN ${period.toUpperCase()}')]);
    sheet.appendRow([t('Total functions'), i(s.totalEvents)]);
    for (final status in _kEventStatuses) {
      sheet.appendRow([t('  ${kEventStatusLabel[status] ?? status}'), i(s.statusCount(status))]);
    }
    sheet.appendRow([]);

    bold([t('VALUE OF CONFIRMED / SETTLED FUNCTIONS')]);
    sheet.appendRow([t('Functions counted'), i(totals.count)]);
    sheet.appendRow([t('Venue charge'), m(totals.venueCharge)]);
    sheet.appendRow([t('Catering amount'), m(totals.cateringAmount)]);
    sheet.appendRow([t('Add-ons'), m(totals.addonsTotal)]);
    sheet.appendRow([t('Less: discount'), m(totals.discountAmount)]);
    bold([t('Total value'), m(totals.totalAmount)]);
    sheet.appendRow([t('Advance held'), m(totals.advanceAmount)]);
    bold([t('Balance due'), m(totals.balanceDue)]);

    if (cancelled.count > 0) {
      sheet.appendRow([]);
      bold([t('CANCELLED FUNCTIONS')]);
      sheet.appendRow([t('Cancelled - count'), i(cancelled.count)]);
      sheet.appendRow([t('Cancelled - advance held'), m(cancelled.advanceHeld)]);
      if (cancelled.refunded > 0 || cancelled.chargesKept > 0) {
        sheet.appendRow([t('Cancelled - refunded to organiser'), m(cancelled.refunded)]);
        sheet.appendRow([t('Cancelled - cancellation charges kept'), m(cancelled.chargesKept)]);
      }
    }

    final typeEntries = s.byEventType.entries.toList();
    if (typeEntries.isNotEmpty) {
      sheet.appendRow([]);
      bold([
        t('By function type'), t('Count'), t('Venue charge'), t('Catering'), t('Add-ons'), t('Discount'),
        t('Total'), t('Advance'), t('Balance due'),
      ]);
      for (final entry in typeEntries) {
        final v = entry.value;
        sheet.appendRow([
          t(kEventTypeLabel[entry.key] ?? entry.key),
          i(v.count),
          m(v.venueCharge),
          m(v.cateringAmount),
          m(v.addonsTotal),
          m(v.discountAmount),
          m(v.totalAmount),
          m(v.advanceAmount),
          m(v.balanceDue),
        ]);
      }
      bold([
        t('Total'), i(totals.count), m(totals.venueCharge), m(totals.cateringAmount), m(totals.addonsTotal),
        m(totals.discountAmount), m(totals.totalAmount), m(totals.advanceAmount), m(totals.balanceDue),
      ]);
    }
  }

  static void _functionsSheet(xl.Excel excel, EventsReport report) {
    final sheet = excel['Functions'];
    final totals = report.summary.totals;
    const headers = [
      'Bill no.', 'Function', 'Type', 'Organiser', 'Phone', 'Venue', 'Start', 'End', 'Pax', 'Status',
      'Venue charge', 'Catering', 'Add-ons', 'Discount', 'Total', 'Advance', 'Balance due', 'Document',
    ];
    sheet.appendRow([for (final h in headers) xl.TextCellValue(h)]);
    final headerRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: headerRow))
          .cellStyle = xl.CellStyle(bold: true);
    }

    for (final ev in report.events) {
      final excluded = _excluded(ev.status);
      xl.CellValue money(num v) => excluded ? xl.TextCellValue('') : xl.DoubleCellValue(v.toDouble());
      sheet.appendRow([
        xl.TextCellValue(ev.invoiceNumber ?? ''),
        xl.TextCellValue(ev.title),
        xl.TextCellValue(kEventTypeLabel[ev.eventType] ?? ev.eventType),
        xl.TextCellValue(ev.organiserName ?? ''),
        xl.TextCellValue(ev.organiserPhone ?? ''),
        xl.TextCellValue(ev.venueName ?? ''),
        xl.TextCellValue(ReportPdfStyle.dateTime(DateTime.tryParse(ev.startAt) ?? DateTime.now())),
        xl.TextCellValue(ev.endAt == null ? '' : ReportPdfStyle.dateTime(DateTime.tryParse(ev.endAt!) ?? DateTime.now())),
        xl.IntCellValue(ev.pax),
        xl.TextCellValue(kEventStatusLabel[ev.status] ?? ev.status),
        money(ev.venueCharge),
        money(ev.cateringAmount),
        money(ev.addonsTotal),
        money(ev.discountAmount),
        money(ev.totalAmount),
        money(ev.advanceAmount),
        money(ev.balanceDue),
        xl.TextCellValue(ev.documentType ?? ''),
      ]);
    }

    sheet.appendRow([
      xl.TextCellValue('Total'), xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''),
      xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''), xl.TextCellValue(''),
      xl.TextCellValue(''),
      xl.DoubleCellValue(totals.venueCharge.toDouble()),
      xl.DoubleCellValue(totals.cateringAmount.toDouble()),
      xl.DoubleCellValue(totals.addonsTotal.toDouble()),
      xl.DoubleCellValue(totals.discountAmount.toDouble()),
      xl.DoubleCellValue(totals.totalAmount.toDouble()),
      xl.DoubleCellValue(totals.advanceAmount.toDouble()),
      xl.DoubleCellValue(totals.balanceDue.toDouble()),
      xl.TextCellValue(''),
    ]);
    final totalsRow = sheet.maxRows - 1;
    for (var c = 0; c < headers.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: totalsRow))
          .cellStyle = xl.CellStyle(bold: true);
    }
  }
}

const _kEventStatuses = ['DRAFT', 'CONFIRMED', 'SETTLED', 'CANCELLED'];

bool _excluded(String status) => status == 'CANCELLED';
