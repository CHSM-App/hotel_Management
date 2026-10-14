import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'laundry_report_excel.dart' show kLaundryOrderStatusLabel;
import 'report_pdf_style.dart';

/// The Laundry report as a real (selectable-text) PDF — the native
/// equivalent of frontend/src/pages/lodge/laundryReportFile.js's
/// buildLaundryReportPdf(): hotel linen tiles and tables, then (when the
/// property also takes guest laundry) a new page with that register.
///
/// Portrait A4, same as the web version.
class LaundryReportPdf {
  static Future<String> download(LaundryReport report, {required bool guestLaundry}) async {
    final bytes = await build(report, guestLaundry: guestLaundry);
    return saveBytesToDevice(bytes, _filename(report));
  }

  static Future<void> share(LaundryReport report, {required bool guestLaundry}) async {
    final bytes = await build(report, guestLaundry: guestLaundry);
    await shareBytesFromDevice(bytes, _filename(report));
  }

  static Future<void> print(LaundryReport report, {required bool guestLaundry}) async {
    final bytes = await build(report, guestLaundry: guestLaundry);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static String _filename(LaundryReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Laundry-report-$period.pdf';
  }

  static Future<Uint8List> build(LaundryReport report, {required bool guestLaundry}) async {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);
    const name = 'Laundry report';
    final generatedAt = DateTime.now();
    final linen = report.linen;
    final guest = report.guest;
    final runningHead = '${ReportPdfStyle.ascii(name)} - laundry report, $period';

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
                    ReportPdfStyle.ascii('Laundry report, $period . All amounts in Rs.'),
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
          ReportPdfStyle.masthead(name: name, title: 'Laundry report', subtitle: period, generatedAt: generatedAt),
          ReportPdfStyle.note(
            'Linen is counted, not valued — a movement belongs to the period by the day it was recorded. Guest '
            'laundry is already counted in Other services and on guests\' bills; the figures below are for '
            'information only and must not be added to any sales total.',
          ),
          ReportPdfStyle.subheading('Hotel laundry this period'),
          ReportPdfStyle.tiles([
            ('Sent for washing', ReportPdfStyle.count(linen.totals.sent)),
            ('Received washed', ReportPdfStyle.count(linen.totals.received)),
            ('Lost', ReportPdfStyle.count(linen.totals.lost)),
            ('Damaged', ReportPdfStyle.count(linen.totals.damaged)),
            ('In wash now', ReportPdfStyle.count(linen.totals.inWashNow)),
          ], width: ReportPdfStyle.contentWidthPortrait, perRow: 3),
          pw.SizedBox(height: 10),

          ReportPdfStyle.subheading('By linen item'),
          if (linen.byItem.isEmpty)
            pw.Text('No linen items recorded yet.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            ReportPdfStyle.table(
              columns: const [
                ReportPdfColumn('Item', flex: 3),
                ReportPdfColumn('Changed', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Sent', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Received', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Lost', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Damaged', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Owned', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('In wash', flex: 1, align: pw.TextAlign.right),
              ],
              fontSize: 7.5,
              rows: [
                for (final i in linen.byItem)
                  [i.name, '${i.changed}', '${i.sent}', '${i.received}', '${i.lost}', '${i.damaged}', '${i.owned}', '${i.inWashNow}'],
              ],
            ),
          pw.SizedBox(height: 10),

          ReportPdfStyle.subheading('By who washed it'),
          if (linen.byWasher.isEmpty)
            pw.Text('Nothing was sent for washing in this period.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            ReportPdfStyle.table(
              columns: const [
                ReportPdfColumn('Washed by', flex: 3),
                ReportPdfColumn('Sent', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Received', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Lost', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Damaged', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Not back', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Charged', flex: 1, align: pw.TextAlign.right),
              ],
              fontSize: 7.5,
              rows: [
                for (final w in linen.byWasher)
                  [
                    w.washedBy.isEmpty ? 'Not recorded' : w.washedBy,
                    '${w.sent}',
                    '${w.received}',
                    '${w.lost}',
                    '${w.damaged}',
                    '${w.notBack}',
                    w.charge > 0 ? ReportPdfStyle.amount(w.charge) : '—',
                  ],
              ],
            ),

          if (guestLaundry) ...[
            pw.NewPage(),
            ReportPdfStyle.heading('Guest laundry taken in this period'),
            ReportPdfStyle.note(
              'Handed over, Still open and Vendor prices are already counted in Other services and on the bills — '
              'shown here for information only. The vendor price itself is also logged under the Laundry expense '
              'category.',
            ),
            ReportPdfStyle.tiles([
              ('Orders taken in', ReportPdfStyle.count(guest.totals.takenIn)),
              ('Cancelled', ReportPdfStyle.count(guest.totals.cancelled)),
              ('Pieces', ReportPdfStyle.count(guest.totals.pieces)),
              ('Handed over', '${ReportPdfStyle.amount(guest.totals.handedOverValue)} (${guest.totals.handedOver})'),
              ('Still open', '${ReportPdfStyle.amount(guest.totals.openValue)} (${guest.totals.open})'),
              ('Profit', ReportPdfStyle.amount(guest.totals.profit)),
            ], width: ReportPdfStyle.contentWidthPortrait, perRow: 3),
            pw.SizedBox(height: 10),
            ReportPdfStyle.subheading(
              'Register - ${guest.orders.length} ${guest.orders.length == 1 ? 'order' : 'orders'} taken in',
            ),
            if (guest.orders.isEmpty)
              pw.Text('No guest laundry taken in during this period.',
                  style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
            else
              ReportPdfStyle.table(
                columns: const [
                  ReportPdfColumn('Tag', flex: 40),
                  ReportPdfColumn('Guest', flex: 90),
                  ReportPdfColumn('Room', flex: 40),
                  ReportPdfColumn('Pcs', flex: 28, align: pw.TextAlign.right),
                  ReportPdfColumn('Status', flex: 56),
                  ReportPdfColumn('Taken in', flex: 88),
                  ReportPdfColumn('Handed over', flex: 88),
                  ReportPdfColumn('Amount', flex: 45, align: pw.TextAlign.right),
                ],
                fontSize: 7,
                rows: [
                  for (final o in guest.orders)
                    [
                      o.tagNumber,
                      o.guestName ?? '—',
                      o.roomNumber ?? 'Walk-in',
                      '${o.pieces}',
                      kLaundryOrderStatusLabel[o.status] ?? o.status,
                      ReportPdfStyle.dateTime(DateTime.tryParse(o.receivedAt) ?? DateTime.now()),
                      o.deliveredAt == null ? '—' : ReportPdfStyle.dateTime(DateTime.tryParse(o.deliveredAt!) ?? DateTime.now()),
                      ReportPdfStyle.amount(o.total),
                    ],
                ],
              ),
          ],
        ],
      ),
    );

    return doc.save();
  }
}
