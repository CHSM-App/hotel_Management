import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'report_pdf_style.dart';

/// The food orders register as a real PDF — same family as [EventReportPdf].
class FoodOrderReportPdf {
  static Future<void> download(FoodOrdersReport report) async {
    final bytes = await build(report);
    await saveBytesToDevice(bytes, _filename(report));
  }

  static Future<void> share(FoodOrdersReport report) async {
    final bytes = await build(report);
    await shareBytesFromDevice(bytes, _filename(report));
  }

  static Future<void> print(FoodOrdersReport report) async {
    final bytes = await build(report);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static String _filename(FoodOrdersReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'Food-orders-report-$period.pdf';
  }

  static Future<Uint8List> build(FoodOrdersReport report) async {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);
    final name = report.lodgeName.isEmpty ? 'Food orders report' : report.lodgeName;
    final generatedAt = DateTime.tryParse(report.generatedAt ?? '') ?? DateTime.now();
    final s = report.summary;
    final runningHead = '${ReportPdfStyle.ascii(name)} - food orders report, $period';

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
                    ReportPdfStyle.ascii('$name . Food orders report, $period . All amounts in Rs.'),
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
            title: 'Food orders report',
            subtitle: period,
            generatedAt: generatedAt,
          ),
          ReportPdfStyle.tiles([
            ('Orders', '${s.totalOrders}'),
            ('Delivered', '${s.deliveredCount}'),
            ('Cancelled', '${s.cancelledCount}'),
            ('Billed', ReportPdfStyle.amount(s.billedValue)),
          ], perRow: 4),
          pw.SizedBox(height: 16),
          ReportPdfStyle.heading('Food orders', subtitle: '${report.orders.length} orders'),
          if (report.orders.isEmpty)
            pw.Text('No food orders in this period.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            _registerTable(report),
        ],
      ),
    );

    return doc.save();
  }

  static pw.Widget _registerTable(FoodOrdersReport report) {
    num total = 0;
    for (final o in report.orders) {
      total += o.subtotal;
    }
    return ReportPdfStyle.table(
      columns: const [
        ReportPdfColumn('Order', flex: 0.8),
        ReportPdfColumn('Placed', flex: 1.2),
        ReportPdfColumn('Source', flex: 1),
        ReportPdfColumn('Guest', flex: 1.3),
        ReportPdfColumn('Items', flex: 0.6, align: pw.TextAlign.right),
        ReportPdfColumn('Status', flex: 0.9),
        ReportPdfColumn('Bill no.', flex: 1),
        ReportPdfColumn('Amount', flex: 1, align: pw.TextAlign.right),
      ],
      rows: [
        for (final o in report.orders)
          [
            '#${o.orderNumber}',
            ReportPdfStyle.dateTime(DateTime.tryParse(o.placedAt) ?? DateTime.now()),
            '${kOrderSourceLabel[o.source] ?? o.source}${_place(o)}',
            o.guestName ?? '-',
            '${o.itemCount}',
            kOrderStatusLabel[o.status] ?? o.status,
            o.invoiceNumber ?? '-',
            ReportPdfStyle.amount(o.subtotal),
          ],
      ],
      totals: ['Total', '', '', '', '${report.orders.length}', '', '', ReportPdfStyle.amount(total)],
    );
  }

  static String _place(ReportFoodOrderRow o) {
    final place = o.roomNumber ?? o.tableLabel;
    return place == null ? '' : ' - $place';
  }
}
