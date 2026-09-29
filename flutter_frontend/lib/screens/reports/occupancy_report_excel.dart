import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import 'report_pdf_style.dart';

/// The occupancy report as a real .xlsx — one sheet, the same day-by-day
/// table [OccupancyReportPdf] and occupancy_report_panel.dart's data grid
/// show, plus a totals row.
class OccupancyReportExcel {
  static Future<String> download(OccupancyReport report, {String? lodgeName}) async {
    final bytes = build(report, lodgeName: lodgeName);
    return saveBytesToDevice(bytes, _filename(report));
  }

  static String _filename(OccupancyReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Occupancy-report-$period.xlsx';
  }

  static Uint8List build(OccupancyReport report, {String? lodgeName}) {
    final excel = xl.Excel.createExcel();
    final defaultSheet = excel.getDefaultSheet();
    final sheet = excel['Occupancy'];
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);

    xl.TextCellValue t(String s) => xl.TextCellValue(s);

    void bold(List<xl.CellValue?> row) {
      sheet.appendRow(row);
      final r = sheet.maxRows - 1;
      for (var c = 0; c < row.length; c++) {
        sheet
            .cell(xl.CellIndex.indexByColumnRow(columnIndex: c, rowIndex: r))
            .cellStyle = xl.CellStyle(bold: true);
      }
    }

    bold([t(lodgeName?.isNotEmpty == true ? lodgeName! : 'Occupancy report')]);
    sheet.appendRow([t('Occupancy report'), t(period)]);
    sheet.appendRow([t('Average occupancy'), t('${report.occupancyPercent}%')]);
    sheet.appendRow([t('Room-nights occupied'), t('${report.occupiedRoomNights} / ${report.totalRoomNights}')]);
    sheet.appendRow([t('Active rooms'), xl.IntCellValue(report.totalRooms)]);
    sheet.appendRow([]);

    bold([t('Date'), t('Occupied'), t('Total rooms'), t('Occupancy %')]);
    for (final day in report.days) {
      sheet.appendRow([
        t(ReportPdfStyle.dateOnly(day.date)),
        xl.IntCellValue(day.occupiedRooms),
        xl.IntCellValue(day.totalRooms),
        xl.DoubleCellValue(day.occupancyPercent.toDouble()),
      ]);
    }
    bold([
      t('Total'),
      xl.IntCellValue(report.occupiedRoomNights),
      xl.IntCellValue(report.totalRoomNights),
      xl.DoubleCellValue(report.occupancyPercent.toDouble()),
    ]);

    if (defaultSheet != null && defaultSheet != 'Occupancy') excel.delete(defaultSheet);

    final bytes = excel.encode();
    if (bytes == null) throw StateError('Could not build the workbook.');
    return Uint8List.fromList(bytes);
  }
}
