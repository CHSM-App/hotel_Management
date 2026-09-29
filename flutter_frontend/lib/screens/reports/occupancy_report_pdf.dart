import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'report_pdf_style.dart';

/// The occupancy report as a real PDF. Web has no equivalent to match — this
/// invents a format consistent with [BookingReportPdf]'s masthead/heading/
/// table style, and with what occupancy_report_panel.dart already shows on
/// screen: the average, room-nights and active-rooms tiles, then the
/// day-by-day table.
///
/// Portrait A4: three columns is not the register's nineteen.
class OccupancyReportPdf {
  static Future<String> download(OccupancyReport report, {String? lodgeName}) async {
    final bytes = await build(report, lodgeName: lodgeName);
    return saveBytesToDevice(bytes, _filename(report));
  }

  static Future<void> share(OccupancyReport report, {String? lodgeName}) async {
    final bytes = await build(report, lodgeName: lodgeName);
    await shareBytesFromDevice(bytes, _filename(report));
  }

  static Future<void> print(OccupancyReport report, {String? lodgeName}) async {
    final bytes = await build(report, lodgeName: lodgeName);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static String _filename(OccupancyReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Occupancy-report-$period.pdf';
  }

  static Future<Uint8List> build(OccupancyReport report, {String? lodgeName}) async {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);
    final name = (lodgeName?.isNotEmpty ?? false) ? lodgeName! : 'Occupancy report';
    final generatedAt = DateTime.now();
    final runningHead = '${ReportPdfStyle.ascii(name)} - occupancy report, $period';

    final doc = pw.Document();
    doc.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4.copyWith(
          marginLeft: ReportPdfStyle.margin,
          marginRight: ReportPdfStyle.margin,
          marginTop: ReportPdfStyle.margin,
          marginBottom: ReportPdfStyle.margin + 16,
        ),
        header: (context) => context.pageNumber == 1
            ? pw.SizedBox()
            : pw.Padding(
                padding: const pw.EdgeInsets.only(bottom: 10),
                child: pw.Text(runningHead, style: pw.TextStyle(fontSize: 7.5, color: ReportPdfStyle.muted)),
              ),
        footer: (context) => pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.stretch,
          children: [
            pw.Container(height: 0.5, color: ReportPdfStyle.rule),
            pw.SizedBox(height: 4),
            pw.Row(
              children: [
                pw.Expanded(
                  child: pw.Text(
                    ReportPdfStyle.ascii('$name . Occupancy report, $period'),
                    style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted),
                  ),
                ),
                pw.Text('Page ${context.pageNumber} of ${context.pagesCount}',
                    style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted)),
              ],
            ),
          ],
        ),
        build: (context) => [
          ReportPdfStyle.masthead(
            name: name,
            title: 'Occupancy report',
            subtitle: period,
            generatedAt: generatedAt,
          ),
          ReportPdfStyle.note(
            'Occupied room-nights count only stays that actually happened - checked in or checked out. A booked '
            'reservation that never arrived, or a cancelled one, never occupied the room.',
          ),
          ReportPdfStyle.tiles([
            ('Average occupancy', '${report.occupancyPercent}%'),
            ('Room-nights occupied', '${report.occupiedRoomNights} / ${report.totalRoomNights}'),
            ('Active rooms', '${report.totalRooms}'),
          ], width: ReportPdfStyle.contentWidthPortrait, perRow: 3),
          pw.SizedBox(height: 16),
          if (report.totalRooms == 0)
            pw.Text('No active rooms on this property.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else ...[
            ReportPdfStyle.heading('Day by day', subtitle: '${report.days.length} days'),
            ReportPdfStyle.table(
              columns: const [
                ReportPdfColumn('Date', flex: 2),
                ReportPdfColumn('Occupied', flex: 1.4, align: pw.TextAlign.right),
                ReportPdfColumn('Total rooms', flex: 1.4, align: pw.TextAlign.right),
                ReportPdfColumn('Occupancy', flex: 1.4, align: pw.TextAlign.right),
              ],
              rows: [
                for (final day in report.days)
                  [
                    ReportPdfStyle.dateOnly(day.date),
                    '${day.occupiedRooms}',
                    '${day.totalRooms}',
                    '${day.occupancyPercent}%',
                  ],
              ],
              totals: [
                'Total',
                '${report.occupiedRoomNights}',
                '${report.totalRoomNights}',
                '${report.occupancyPercent}%',
              ],
            ),
          ],
        ],
      ),
    );

    return doc.save();
  }
}
