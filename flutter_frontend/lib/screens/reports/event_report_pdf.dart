import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'report_pdf_style.dart';

/// The events & functions register as a real PDF — same family as
/// [GstReportPdf]/[BookingReportPdf]: masthead, stat tiles, then the register.
class EventReportPdf {
  static Future<void> download(EventsReport report) async {
    final bytes = await build(report);
    await saveBytesToDevice(bytes, _filename(report));
  }

  static Future<void> share(EventsReport report) async {
    final bytes = await build(report);
    await shareBytesFromDevice(bytes, _filename(report));
  }

  static Future<void> print(EventsReport report) async {
    final bytes = await build(report);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static String _filename(EventsReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Events-report-$period.pdf';
  }

  static Future<Uint8List> build(EventsReport report) async {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);
    final name = report.lodgeName.isEmpty ? 'Events report' : report.lodgeName;
    final generatedAt = DateTime.tryParse(report.generatedAt ?? '') ?? DateTime.now();
    final s = report.summary;
    final runningHead = '${ReportPdfStyle.ascii(name)} - events report, $period';

    final doc = pw.Document();
    doc.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4.landscape.copyWith(
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
                    ReportPdfStyle.ascii('$name . Events report, $period . All amounts in Rs.'),
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
            title: 'Events & functions report',
            subtitle: period,
            generatedAt: generatedAt,
          ),
          ReportPdfStyle.tiles([
            ('Functions', '${s.totalEvents}'),
            ('Settled', '${s.statusCount('SETTLED')}'),
            ('Confirmed', '${s.statusCount('CONFIRMED')}'),
            ('Cancelled', '${s.cancelled.count}'),
            ('Total value', ReportPdfStyle.amount(s.totals.totalAmount)),
            ('Advance held', ReportPdfStyle.amount(s.totals.advanceAmount)),
          ], perRow: 6),
          pw.SizedBox(height: 16),
          ReportPdfStyle.heading('Functions & events', subtitle: '${report.events.length} functions'),
          if (report.events.isEmpty)
            pw.Text('No functions in this period.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            _registerTable(report),
        ],
      ),
    );

    return doc.save();
  }

  static pw.Widget _registerTable(EventsReport report) {
    final s = report.summary;
    return ReportPdfStyle.table(
      columns: const [
        ReportPdfColumn('Bill no.', flex: 1.1),
        ReportPdfColumn('Function', flex: 1.6),
        ReportPdfColumn('Organiser', flex: 1.5),
        ReportPdfColumn('Venue', flex: 1.2),
        ReportPdfColumn('Date', flex: 1),
        ReportPdfColumn('Pax', flex: 0.6, align: pw.TextAlign.right),
        ReportPdfColumn('Status', flex: 0.9),
        ReportPdfColumn('Advance', flex: 1, align: pw.TextAlign.right),
        ReportPdfColumn('Total', flex: 1, align: pw.TextAlign.right),
        ReportPdfColumn('Balance due', flex: 1, align: pw.TextAlign.right),
      ],
      rows: [
        for (final ev in report.events)
          [
            ev.invoiceNumber ?? '-',
            ev.title,
            ev.organiserName ?? '-',
            ev.venueName ?? '-',
            ReportPdfStyle.dateTime(DateTime.tryParse(ev.startAt) ?? DateTime.now()),
            '${ev.pax}',
            kEventStatusLabel[ev.status] ?? ev.status,
            ev.advanceAmount > 0 ? ReportPdfStyle.amount(ev.advanceAmount) : '-',
            ReportPdfStyle.amount(ev.totalAmount),
            ev.balanceDue > 0 ? ReportPdfStyle.amount(ev.balanceDue) : '-',
          ],
      ],
      totals: [
        'Total', '', '', '', '', '',
        '${s.totalEvents}',
        ReportPdfStyle.amount(s.totals.advanceAmount),
        ReportPdfStyle.amount(s.totals.totalAmount),
        ReportPdfStyle.amount(s.totals.balanceDue),
      ],
    );
  }
}
