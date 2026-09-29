import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import 'booking_register_rows.dart';
import 'report_pdf_style.dart';

/// The booking report as a real .xlsx — the native equivalent of
/// frontend/src/pages/lodge/bookingReportFile.js's
/// downloadBookingReportExcel(): a "Summary" sheet with the same totals the
/// PDF's parts 1 and 2 print, and a "Bookings" sheet with one row per stay
/// (the same register the PDF's part 3 and the on-screen data grid share —
/// see booking_register_rows.dart) plus a footed totals row.
class BookingReportExcel {
  static Future<void> download(BookingsReport report) async {
    final bytes = build(report);
    await saveBytesToDevice(bytes, _filename(report));
  }

  static String _filename(BookingsReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Booking-report-$period.xlsx';
  }

  static num _advanceDeducted(BookingsReport report) {
    num sum = 0;
    for (final b in report.bookings) {
      if (b.status != 'CANCELLED' && b.advancePaid != null) sum += b.advancePaid!;
    }
    return (sum * 100).round() / 100;
  }

  static Uint8List build(BookingsReport report) {
    final bills = report.summary.bills.withAdvanceDeducted(_advanceDeducted(report));
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();

    _summarySheet(excel, report, bills);
    _bookingsSheet(excel, report, bills);

    if (defaultSheet != null && defaultSheet != 'Summary' && defaultSheet != 'Bookings') {
      excel.delete(defaultSheet);
    }

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }

  // ── Summary sheet ───────────────────────────────────────────────────────

  static void _summarySheet(xl.Excel excel, BookingsReport report, ReportBillTotals bills) {
    final sheet = excel['Summary'];
    final summary = report.summary;
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);

    void bold(List<xl.CellValue?> row) {
      sheet.appendRow(row);
      final r = sheet.maxRows - 1;
      for (var c = 0; c < row.length; c++) {
        sheet
            .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: r))
            .cellStyle = xl.CellStyle(bold: true);
      }
    }

    xl.TextCellValue t(String s) => xl.TextCellValue(s);
    xl.DoubleCellValue m(num n) => xl.DoubleCellValue(n.toDouble());
    xl.IntCellValue i(int n) => xl.IntCellValue(n);

    bold([t(report.lodgeName.isEmpty ? 'Booking report' : report.lodgeName)]);
    sheet.appendRow([t('Booking report'), t(period)]);
    if (report.gstin != null) sheet.appendRow([t('GSTIN'), t(report.gstin!)]);
    sheet.appendRow([t('Bills included'), t(_billingSideLabel(report.billingSide))]);
    sheet.appendRow([]);

    bold([t('1. MONEY RECEIVED IN ${period.toUpperCase()}')]);
    sheet.appendRow([t('Advances received'), m(summary.advanceCollected)]);
    sheet.appendRow([t('Final payments received'), m(summary.balanceCollected)]);
    if (summary.cancellationChargesKept > 0) {
      sheet.appendRow([t('Cancellation charges kept'), m(summary.cancellationChargesKept)]);
    }
    bold([t('Total received'), m(summary.totalCollected)]);
    sheet.appendRow([]);

    bold([t('By payment mode'), t('Advances'), t('Final payments'), t('Total')]);
    const modes = ['CASH', 'UPI', 'CARD', 'UNRECORDED'];
    for (final mode in modes) {
      final split = summary.byPaymentMode[mode];
      if (split == null || (mode == 'UNRECORDED' && split.total == 0)) continue;
      sheet.appendRow([t(paymentModeLabel(mode)), m(split.advance), m(split.balance), m(split.total)]);
    }
    final modeSplitTotal = summary.advanceCollected + summary.balanceCollected;
    bold([t('Total by mode'), m(summary.advanceCollected), m(summary.balanceCollected), m(modeSplitTotal)]);
    sheet.appendRow([]);

    final byStay = summary.collections.byStayPeriod;
    if (byStay.isNotEmpty) {
      bold([t('By the stay it was for'), t('Advances'), t('Final payments'), t('Total')]);
      for (final (key, label) in [
        ('EARLIER', 'Stays that checked in before this period'),
        ('THIS', 'Stays checking in this period'),
        ('LATER', 'Stays checking in after this period'),
      ]) {
        final s = byStay[key];
        sheet.appendRow([t(label), m(s?.advance ?? 0), m(s?.balance ?? 0), m(s?.total ?? 0)]);
      }
      bold([t('Total by stay'), m(summary.advanceCollected), m(summary.balanceCollected), m(modeSplitTotal)]);
      sheet.appendRow([]);
    }

    bold([t('2. STAYS CHECKING IN ${period.toUpperCase()}')]);
    sheet.appendRow([t('Bookings'), i(summary.totalBookings)]);
    for (final entry in kBookingStatusLabel.entries) {
      sheet.appendRow([t('  ${entry.value}'), i(summary.statusCount(entry.key))]);
    }
    sheet.appendRow([t('Room nights (excluding cancelled)'), i(summary.roomNights)]);
    sheet.appendRow([t('Booked value (excluding cancelled)'), m(summary.bookedValue)]);
    sheet.appendRow([t('  Billed - bills issued'), i(summary.billedCount)]);
    sheet.appendRow([t('  Billed total'), m(bills.totalAmount)]);
    sheet.appendRow([t('  Not yet billed - stays'), i(summary.unbilledCount)]);
    sheet.appendRow([t('  Not yet billed - booked value'), m(summary.unbilledValue)]);
    final cancelled = summary.cancelled;
    if (cancelled.count > 0) {
      sheet.appendRow([t('Cancelled - bookings'), i(cancelled.count)]);
      sheet.appendRow([t('Cancelled - booked value, not counted'), m(cancelled.bookedValue)]);
      sheet.appendRow([t('Cancelled - advance held'), m(cancelled.advanceHeld)]);
      if (cancelled.refunded > 0 || cancelled.chargesKept > 0) {
        sheet.appendRow([t('Cancelled - refunded to guests'), m(cancelled.refunded)]);
        sheet.appendRow([t('Cancelled - cancellation charges'), m(cancelled.chargesKept)]);
      }
    }
    sheet.appendRow([]);

    bold([t('BILLS ISSUED FOR THESE STAYS')]);
    for (final (label, value, isCount) in _billTotalPairs(bills, report.servesFood)) {
      sheet.appendRow([t(label), isCount ? i(value.toInt()) : m(value)]);
    }
    sheet.appendRow([]);

    bold([t('Tax by supply'), t('SAC'), t('Taxable value'), t('CGST'), t('SGST'), t('Total tax')]);
    sheet.appendRow([
      t('Accommodation'), t('996311'), m(bills.roomTaxable), m(bills.roomCgst), m(bills.roomSgst),
      m(bills.roomCgst + bills.roomSgst),
    ]);
    if (report.servesFood) {
      sheet.appendRow([
        t('Food'), t('996331'), m(bills.foodTaxable), m(bills.foodCgst), m(bills.foodSgst),
        m(bills.foodCgst + bills.foodSgst),
      ]);
      bold([
        t('Total'), t(''), m(bills.taxableValue), m(bills.cgstAmount), m(bills.sgstAmount), m(bills.totalTax),
      ]);
    }
    sheet.appendRow([]);

    bold([
      t('By document'), t('Bills'), t('Gross amount'), t('Discount'), t('Taxable value'), t('CGST'), t('SGST'),
      t('Round off'), t('Billed total'),
    ]);
    const types = ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'CASH_RECEIPT'];
    for (final type in types) {
      final d = summary.byDocumentType[type];
      if (d == null || d.count == 0) continue;
      sheet.appendRow([
        t(kDocumentTypeLabel[type] ?? type), i(d.count), m(d.grossAmount), m(d.discountAmount),
        m(d.taxableValue), m(d.cgstAmount), m(d.sgstAmount), m(d.roundOff), m(d.totalAmount),
      ]);
    }
    bold([
      t('Total'), i(bills.count), m(bills.grossAmount), m(bills.discountAmount), m(bills.taxableValue),
      m(bills.cgstAmount), m(bills.sgstAmount), m(bills.roundOff), m(bills.totalAmount),
    ]);
    sheet.appendRow([]);

    bold([t('SETTLEMENT OF THESE BILLS')]);
    sheet.appendRow([t('Billed total'), m(bills.totalAmount)]);
    sheet.appendRow([t('Less: advance deducted on the bills'), m(bills.advanceDeducted)]);
    sheet.appendRow([t('Less: balance collected on the bills'), m(summary.stayBalance)]);
    bold([t('Balance still due'), m(summary.stayBalanceDue)]);
  }

  static List<(String, num, bool)> _billTotalPairs(ReportBillTotals bills, bool servesFood) => [
    ('Bills issued', bills.count, true),
    ('Gross amount (tax inside)', bills.grossAmount, false),
    ('Less: discount', bills.discountAmount, false),
    ('Net amount', bills.netAmount, false),
    if (servesFood) ...[
      ('Taxable value - rooms', bills.roomTaxable, false),
      ('Taxable value - food', bills.foodTaxable, false),
    ],
    ('Taxable value', bills.taxableValue, false),
    ('CGST', bills.cgstAmount, false),
    ('SGST', bills.sgstAmount, false),
    ('Total tax', bills.totalTax, false),
    ('Round off', bills.roundOff, false),
    ('Billed total', bills.totalAmount, false),
  ];

  static String _billingSideLabel(String side) => switch (side) {
    'GST' => 'GST bills only',
    'NON_GST' => 'Non-GST bills only',
    _ => 'All bills',
  };

  // ── Bookings sheet ──────────────────────────────────────────────────────

  static void _bookingsSheet(xl.Excel excel, BookingsReport report, ReportBillTotals bills) {
    final sheet = excel['Bookings'];
    sheet.appendRow([for (final c in kRegisterColumns) xl.TextCellValue(c.label)]);
    final headerRow = sheet.maxRows - 1;
    for (var c = 0; c < kRegisterColumns.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: headerRow))
          .cellStyle = xl.CellStyle(bold: true);
    }

    for (final b in report.bookings) {
      sheet.appendRow([for (final cell in registerRow(b)) xl.TextCellValue(cell)]);
    }

    final totals = registerTotalsRow(report.summary, bills);
    sheet.appendRow([for (final cell in totals) xl.TextCellValue(cell)]);
    final totalsRow = sheet.maxRows - 1;
    for (var c = 0; c < totals.length; c++) {
      sheet
          .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: totalsRow))
          .cellStyle = xl.CellStyle(bold: true);
    }
  }
}
