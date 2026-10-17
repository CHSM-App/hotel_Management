import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'report_pdf_style.dart';

String _statusLabel(ServiceUsageRow u) {
  if (u.voided) return 'Voided';
  if (u.status == 'CANCELLED') return 'Cancelled';
  if (u.status == 'IN_USE') return 'In use';
  if (u.status == 'COMPLETED') return 'Completed';
  return u.status;
}

/// The Other services report as a real (selectable-text) PDF — the native
/// equivalent of frontend/src/pages/lodge/servicesReportFile.js's
/// buildServicesReportPdf(): masthead, explanatory note, headline tiles, a
/// "By service" table, then a new page with the full register.
///
/// Portrait A4, same as the web version.
class ServicesReportPdf {
  static Future<String> download(ServicesReport report, {String? lodgeName}) async {
    final bytes = await build(report, lodgeName: lodgeName);
    return saveBytesToDevice(bytes, _filename(report));
  }

  static Future<void> share(ServicesReport report, {String? lodgeName}) async {
    final bytes = await build(report, lodgeName: lodgeName);
    await shareBytesFromDevice(bytes, _filename(report));
  }

  static Future<void> print(ServicesReport report, {String? lodgeName}) async {
    final bytes = await build(report, lodgeName: lodgeName);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static String _filename(ServicesReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Other-services-report-$period.pdf';
  }

  // Cancelled and voided uses add nothing — mirrors the usages.reduce() in
  // servicesReportFile.js, which also skips them.
  static num _totalAmount(ServicesReport report) {
    num sum = 0;
    for (final u in report.usages) {
      if (u.status != 'CANCELLED' && !u.voided) sum += u.lineTotal;
    }
    return sum;
  }

  static Future<Uint8List> build(ServicesReport report, {String? lodgeName}) async {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);
    final name = (lodgeName?.isNotEmpty ?? false) ? lodgeName! : 'Other services report';
    final generatedAt = DateTime.now();
    final t = report.totals;
    final runningHead = '${ReportPdfStyle.ascii(name)} - other services report, $period';

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
                    ReportPdfStyle.ascii('$name . Other services report, $period . All amounts in Rs.'),
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
            title: 'Other services report',
            subtitle: period,
            generatedAt: generatedAt,
          ),
          ReportPdfStyle.note(
            'A use is counted on the calendar day it started. Cancelled uses and voided bills are listed in the '
            'register but excluded from every total here — the value they would have added is never counted. '
            'All amounts in rupees.',
          ),
          ReportPdfStyle.tiles([
            ('Total uses', ReportPdfStyle.count(t.count)),
            ('Cancelled', ReportPdfStyle.count(t.cancelledCount)),
            ('Voided bills', ReportPdfStyle.count(t.voidedCount)),
            ('Billed', ReportPdfStyle.amount(t.billedValue)),
            ('Completed, not billed', ReportPdfStyle.amount(t.unbilledValue)),
          ], width: ReportPdfStyle.contentWidthPortrait, perRow: 3),
          pw.SizedBox(height: 10),

          ReportPdfStyle.subheading('By service'),
          if (report.byService.isEmpty)
            pw.Text('No services used in this period.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            ReportPdfStyle.table(
              columns: const [
                ReportPdfColumn('Service', flex: 3),
                ReportPdfColumn('Uses', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Quantity', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Value', flex: 1, align: pw.TextAlign.right),
              ],
              rows: [
                for (final s in report.byService)
                  [s.serviceName, '${s.uses}', '${s.quantity}', ReportPdfStyle.amount(s.value)],
              ],
              totals: [
                'Total',
                '${report.byService.fold<num>(0, (sum, s) => sum + s.uses)}',
                '${report.byService.fold<num>(0, (sum, s) => sum + s.quantity)}',
                ReportPdfStyle.amount(report.byService.fold<num>(0, (sum, s) => sum + s.value)),
              ],
            ),
          pw.NewPage(),

          ReportPdfStyle.heading(
            'Register - ${report.usages.length} ${report.usages.length == 1 ? 'use' : 'uses'} started $period',
            subtitle: 'Totals foot the rows above them',
          ),
          if (report.usages.isEmpty)
            pw.Text('No services used during this period.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            ReportPdfStyle.table(
              columns: const [
                ReportPdfColumn('Started', flex: 90),
                ReportPdfColumn('Service', flex: 100),
                ReportPdfColumn('Qty', flex: 30, align: pw.TextAlign.right),
                ReportPdfColumn('Head', flex: 30, align: pw.TextAlign.right),
                ReportPdfColumn('Guest', flex: 90),
                ReportPdfColumn('Room', flex: 36),
                ReportPdfColumn('Status', flex: 54),
                ReportPdfColumn('Amount', flex: 47, align: pw.TextAlign.right),
              ],
              fontSize: 7,
              rows: [
                for (final u in report.usages)
                  [
                    ReportPdfStyle.dateTime(DateTime.tryParse(u.startedAt) ?? DateTime.now()),
                    u.serviceName,
                    '${u.quantity}',
                    '${u.headcount}',
                    u.guestName ?? '—',
                    u.roomNumber ?? '—',
                    _statusLabel(u),
                    (u.status == 'CANCELLED' || u.voided) ? '—' : ReportPdfStyle.amount(u.lineTotal),
                  ],
              ],
              totals: ['Total', '', '', '', '', '', '', ReportPdfStyle.amount(_totalAmount(report))],
            ),
        ],
      ),
    );

    return doc.save();
  }
}
