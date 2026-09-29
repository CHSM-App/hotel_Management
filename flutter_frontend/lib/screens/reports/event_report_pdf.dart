import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'report_pdf_style.dart';

const _kEventStatuses = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'SETTLED', 'CANCELLED', 'EXPIRED'];

bool _excluded(String status) => status == 'CANCELLED' || status == 'EXPIRED';

/// The events & functions report, as a real (selectable-text) PDF — the
/// native equivalent of frontend/src/pages/lodge/eventReportFile.js's
/// buildEventsReportPdf(): masthead, explanatory note, headline tiles, the
/// by-status breakdown of functions starting in the period, the value of
/// confirmed/settled functions as two equations, an optional by-function-type
/// table, then a new page with the register.
///
/// Landscape A4, same as the web version — the register carries fourteen
/// money-and-detail columns.
class EventReportPdf {
  static Future<String> download(EventsReport report) async {
    final bytes = await build(report);
    return saveBytesToDevice(bytes, _filename(report));
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
    final name = report.lodgeName.isEmpty ? 'Events & functions report' : report.lodgeName;
    final generatedAt = DateTime.tryParse(report.generatedAt ?? '') ?? DateTime.now();
    final s = report.summary;
    final totals = s.totals;
    final cancelled = s.cancelled;
    final runningHead = '${ReportPdfStyle.ascii(name)} - events & functions report, $period';

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
                    ReportPdfStyle.ascii(
                      '$name . Events & functions report, $period . All amounts in Rs. . '
                      'Cancelled/expired functions excluded from all money figures.',
                    ),
                    style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted),
                    maxLines: 1,
                    overflow: pw.TextOverflow.clip,
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
          ReportPdfStyle.note(
            'Functions are counted by the day they start - a function running past midnight is counted once, on '
            'the evening it begins. Cancelled and expired functions are listed in the register for the record but '
            'excluded from every money figure below, except cancellation charges kept, which are shown separately. '
            'All amounts in rupees.',
          ),
          ReportPdfStyle.tiles([
            ('Functions', '${s.totalEvents}'),
            ('Confirmed', '${s.statusCount('CONFIRMED')}'),
            ('Settled', '${s.statusCount('SETTLED')}'),
            ('Cancelled', '${cancelled.count}'),
            ('Total value', ReportPdfStyle.amount(totals.totalAmount)),
            ('Balance due', ReportPdfStyle.amount(totals.balanceDue)),
          ], width: ReportPdfStyle.contentWidthLandscape, perRow: 6),
          pw.SizedBox(height: 14),

          ReportPdfStyle.heading('Functions starting in $period', subtitle: 'By status'),
          ReportPdfStyle.tiles([
            ('Total functions', '${s.totalEvents}'),
            for (final status in _kEventStatuses) (kEventStatusLabel[status] ?? status, '${s.statusCount(status)}'),
          ], width: ReportPdfStyle.contentWidthLandscape, perRow: 6),
          pw.SizedBox(height: 10),

          ReportPdfStyle.subheading('Value of confirmed / settled functions'),
          ReportPdfStyle.equation([
            ('Venue charge', ReportPdfStyle.amount(totals.venueCharge), false),
            ('Add: catering amount', ReportPdfStyle.amount(totals.cateringAmount), false),
            ('Add: add-ons', ReportPdfStyle.amount(totals.addonsTotal), false),
            ('Less: discount', ReportPdfStyle.amount(totals.discountAmount), false),
            ('Total value', ReportPdfStyle.amount(totals.totalAmount), true),
          ]),
          ReportPdfStyle.equation([
            ('Total value', ReportPdfStyle.amount(totals.totalAmount), false),
            ('Less: advance held', ReportPdfStyle.amount(totals.advanceAmount), false),
            ('Balance due', ReportPdfStyle.amount(totals.balanceDue), true),
          ]),
          ReportPdfStyle.note(
            'Enquiry and tentative functions are counted above by status but excluded from these value totals - '
            'nothing has been confirmed yet to bill against.'
            '${cancelled.count > 0 ? ' ${cancelled.count} cancelled ${cancelled.count == 1 ? 'function' : 'functions'} held ${ReportPdfStyle.amount(cancelled.advanceHeld)} of advance, excluded from the totals above.' : ''}'
            '${(cancelled.refunded > 0 || cancelled.chargesKept > 0) ? ' Of that, ${ReportPdfStyle.amount(cancelled.refunded)} was refunded and ${ReportPdfStyle.amount(cancelled.chargesKept)} kept as cancellation charges.' : ''}',
          ),

          if (s.byEventType.isNotEmpty) ...[
            ReportPdfStyle.subheading('By function type'),
            _byTypeTable(s),
            pw.SizedBox(height: 10),
          ],
          pw.NewPage(),

          ReportPdfStyle.heading(
            'Register - ${report.events.length} ${report.events.length == 1 ? 'function' : 'functions'} starting $period',
            subtitle: 'Money columns blank on cancelled/expired rows; totals foot the rows above them',
          ),
          if (report.events.isEmpty)
            pw.Text('No functions started during this period.',
                style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            _registerTable(report),
        ],
      ),
    );

    return doc.save();
  }

  static pw.Widget _byTypeTable(EventsReportSummary s) {
    final entries = s.byEventType.entries.toList();
    final totals = s.totals;
    return ReportPdfStyle.table(
      columns: const [
        ReportPdfColumn('Type', flex: 1.6),
        ReportPdfColumn('Count', flex: 0.7, align: pw.TextAlign.right),
        ReportPdfColumn('Venue charge', flex: 1.2, align: pw.TextAlign.right),
        ReportPdfColumn('Catering', flex: 1.1, align: pw.TextAlign.right),
        ReportPdfColumn('Add-ons', flex: 1, align: pw.TextAlign.right),
        ReportPdfColumn('Discount', flex: 1, align: pw.TextAlign.right),
        ReportPdfColumn('Total', flex: 1.1, align: pw.TextAlign.right),
        ReportPdfColumn('Advance', flex: 1.1, align: pw.TextAlign.right),
        ReportPdfColumn('Balance due', flex: 1.1, align: pw.TextAlign.right),
      ],
      rows: [
        for (final entry in entries)
          [
            kEventTypeLabel[entry.key] ?? entry.key,
            '${entry.value.count}',
            ReportPdfStyle.amount(entry.value.venueCharge),
            ReportPdfStyle.amount(entry.value.cateringAmount),
            ReportPdfStyle.amount(entry.value.addonsTotal),
            ReportPdfStyle.amount(entry.value.discountAmount),
            ReportPdfStyle.amount(entry.value.totalAmount),
            ReportPdfStyle.amount(entry.value.advanceAmount),
            ReportPdfStyle.amount(entry.value.balanceDue),
          ],
      ],
      totals: entries.length > 1
          ? [
              'Total',
              '${totals.count}',
              ReportPdfStyle.amount(totals.venueCharge),
              ReportPdfStyle.amount(totals.cateringAmount),
              ReportPdfStyle.amount(totals.addonsTotal),
              ReportPdfStyle.amount(totals.discountAmount),
              ReportPdfStyle.amount(totals.totalAmount),
              ReportPdfStyle.amount(totals.advanceAmount),
              ReportPdfStyle.amount(totals.balanceDue),
            ]
          : null,
    );
  }

  static pw.Widget _registerTable(EventsReport report) {
    final totals = report.summary.totals;
    const widths = [44.0, 100.0, 56.0, 90.0, 70.0, 80.0, 28.0, 52.0, 52.0, 52.0, 48.0, 52.0, 52.0, 46.0];
    return ReportPdfStyle.table(
      columns: [
        ReportPdfColumn('Bill no.', flex: widths[0]),
        ReportPdfColumn('Function', flex: widths[1]),
        ReportPdfColumn('Type', flex: widths[2]),
        ReportPdfColumn('Organiser', flex: widths[3]),
        ReportPdfColumn('Venue', flex: widths[4]),
        ReportPdfColumn('Start', flex: widths[5]),
        ReportPdfColumn('Pax', flex: widths[6], align: pw.TextAlign.right),
        ReportPdfColumn('Status', flex: widths[7]),
        ReportPdfColumn('Venue chg', flex: widths[8], align: pw.TextAlign.right),
        ReportPdfColumn('Catering', flex: widths[9], align: pw.TextAlign.right),
        ReportPdfColumn('Discount', flex: widths[10], align: pw.TextAlign.right),
        ReportPdfColumn('Total', flex: widths[11], align: pw.TextAlign.right),
        ReportPdfColumn('Advance', flex: widths[12], align: pw.TextAlign.right),
        ReportPdfColumn('Bal. due', flex: widths[13], align: pw.TextAlign.right),
      ],
      fontSize: 7,
      rows: [
        for (final ev in report.events)
          () {
            final excluded = _excluded(ev.status);
            String val(num v) => excluded ? '—' : ReportPdfStyle.amount(v);
            return [
              ev.invoiceNumber ?? '—',
              ev.title,
              kEventTypeLabel[ev.eventType] ?? ev.eventType,
              ev.organiserName ?? '—',
              ev.venueName ?? '—',
              ReportPdfStyle.dateTime(DateTime.tryParse(ev.startAt) ?? DateTime.now()),
              '${ev.pax}',
              kEventStatusLabel[ev.status] ?? ev.status,
              val(ev.venueCharge),
              val(ev.cateringAmount),
              val(ev.discountAmount),
              val(ev.totalAmount),
              excluded ? '—' : (ev.advanceAmount > 0 ? ReportPdfStyle.amount(ev.advanceAmount) : '—'),
              excluded ? '—' : (ev.balanceDue > 0 ? ReportPdfStyle.amount(ev.balanceDue) : '—'),
            ];
          }(),
      ],
      totals: [
        'Total', '', '', '', '', '', '', '',
        ReportPdfStyle.amount(totals.venueCharge),
        ReportPdfStyle.amount(totals.cateringAmount),
        ReportPdfStyle.amount(totals.discountAmount),
        ReportPdfStyle.amount(totals.totalAmount),
        ReportPdfStyle.amount(totals.advanceAmount),
        ReportPdfStyle.amount(totals.balanceDue),
      ],
    );
  }
}
