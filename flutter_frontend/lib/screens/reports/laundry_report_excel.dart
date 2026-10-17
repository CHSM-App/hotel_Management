import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import 'report_pdf_style.dart';

// Sent to wash, received back from the wash, handed to the guest — mirrors
// GUEST_STATUS in laundryReportFile.js.
const Map<String, String> kLaundryOrderStatusLabel = {
  'RECEIVED': 'In wash',
  'WASHING': 'In wash',
  'READY': 'Received',
  'DELIVERED': 'Handed over',
  'CANCELLED': 'Cancelled',
};

/// The Laundry report as a real .xlsx — the native equivalent of
/// frontend/src/pages/lodge/laundryReportFile.js's downloadLaundryReportExcel():
/// a sheet per block on screen, the guest sheet left out for a property that
/// does not take guest laundry.
class LaundryReportExcel {
  static Future<String> download(LaundryReport report, {required bool guestLaundry}) async {
    final bytes = build(report, guestLaundry: guestLaundry);
    return saveBytesToDevice(bytes, _filename(report));
  }

  static String _filename(LaundryReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Laundry-report-$period.xlsx';
  }

  static Uint8List build(LaundryReport report, {required bool guestLaundry}) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();

    _byItemSheet(excel, report);
    _byWasherSheet(excel, report);
    if (guestLaundry) _guestSheet(excel, report);

    final keep = {'Linen by item', 'By washed by', if (guestLaundry) 'Guest laundry'};
    if (defaultSheet != null && !keep.contains(defaultSheet)) {
      excel.delete(defaultSheet);
    }

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }

  static void _header(xl.Sheet sheet, List<String> labels) {
    sheet.appendRow([for (final h in labels) xl.TextCellValue(h)]);
    final r = sheet.maxRows - 1;
    for (var c = 0; c < labels.length; c++) {
      sheet.cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: r)).cellStyle = xl.CellStyle(bold: true);
    }
  }

  static void _byItemSheet(xl.Excel excel, LaundryReport report) {
    final sheet = excel['Linen by item'];
    _header(sheet, ['Item', 'Changed in rooms', 'Sent for washing', 'Received washed', 'Lost', 'Damaged', 'Owned now', 'In wash now']);
    for (final i in report.linen.byItem) {
      sheet.appendRow([
        xl.TextCellValue(i.name),
        xl.DoubleCellValue(i.changed.toDouble()),
        xl.DoubleCellValue(i.sent.toDouble()),
        xl.DoubleCellValue(i.received.toDouble()),
        xl.DoubleCellValue(i.lost.toDouble()),
        xl.DoubleCellValue(i.damaged.toDouble()),
        xl.DoubleCellValue(i.owned.toDouble()),
        xl.DoubleCellValue(i.inWashNow.toDouble()),
      ]);
    }
  }

  static void _byWasherSheet(xl.Excel excel, LaundryReport report) {
    final sheet = excel['By washed by'];
    _header(sheet, ['Washed by', 'Sent', 'Received', 'Lost', 'Damaged', 'Not back', 'Charged']);
    for (final w in report.linen.byWasher) {
      sheet.appendRow([
        xl.TextCellValue(w.washedBy.isEmpty ? 'Not recorded' : w.washedBy),
        xl.DoubleCellValue(w.sent.toDouble()),
        xl.DoubleCellValue(w.received.toDouble()),
        xl.DoubleCellValue(w.lost.toDouble()),
        xl.DoubleCellValue(w.damaged.toDouble()),
        xl.DoubleCellValue(w.notBack.toDouble()),
        xl.DoubleCellValue(w.charge.toDouble()),
      ]);
    }
  }

  static void _guestSheet(xl.Excel excel, LaundryReport report) {
    final sheet = excel['Guest laundry'];
    _header(sheet, [
      'Tag', 'Guest', 'Room', 'Pieces', 'Status', 'Taken in', 'Handed over', 'Amount', 'Washed by', 'Vendor price', 'Profit',
    ]);
    for (final o in report.guest.orders) {
      sheet.appendRow([
        xl.TextCellValue(o.tagNumber),
        xl.TextCellValue(o.guestName ?? ''),
        xl.TextCellValue(o.roomNumber ?? 'Walk-in'),
        xl.DoubleCellValue(o.pieces.toDouble()),
        xl.TextCellValue(kLaundryOrderStatusLabel[o.status] ?? o.status),
        xl.TextCellValue(ReportPdfStyle.dateTime(DateTime.tryParse(o.receivedAt) ?? DateTime.now())),
        xl.TextCellValue(o.deliveredAt == null ? '' : ReportPdfStyle.dateTime(DateTime.tryParse(o.deliveredAt!) ?? DateTime.now())),
        xl.DoubleCellValue(o.total.toDouble()),
        xl.TextCellValue(o.washedBy ?? ''),
        o.washCharge == null ? xl.TextCellValue('') : xl.DoubleCellValue(o.washCharge!.toDouble()),
        o.profit == null ? xl.TextCellValue('') : xl.DoubleCellValue(o.profit!.toDouble()),
      ]);
    }
  }
}
