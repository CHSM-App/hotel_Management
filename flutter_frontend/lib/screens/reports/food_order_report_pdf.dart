import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'report_pdf_style.dart';

const _kOrderStatuses = ['PENDING', 'QUEUED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];
const _kOrderSources = ['ROOM', 'TABLE', 'COUNTER'];

/// The food orders report, as a real (selectable-text) PDF — the native
/// equivalent of frontend/src/pages/lodge/foodOrderReportFile.js's
/// buildFoodOrdersReportPdf(): masthead, explanatory note, six headline
/// tiles, a by-status table and a by-source table, then a new page with the
/// register.
///
/// Portrait A4, same as the web version — the register is nine columns, none
/// of them tax figures.
class FoodOrderReportPdf {
  static Future<String> download(FoodOrdersReport report) async {
    final bytes = await build(report);
    return saveBytesToDevice(bytes, _filename(report));
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

  // Cancelled orders are never billed, so the register's own totals exclude
  // them — mirrors report.orders.reduce(... o.status === 'CANCELLED' ? sum ...)
  // in foodOrderReportFile.js.
  static num _totalAmount(FoodOrdersReport report) {
    num sum = 0;
    for (final o in report.orders) {
      if (o.status != 'CANCELLED') sum += o.subtotal;
    }
    return sum;
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
          ReportPdfStyle.note(
            'An order is counted on the calendar day it was placed on. Delivered and cancelled orders are both '
            'counted; a live order still in the kitchen queue when this report is pulled counts too, under '
            'whatever status it is currently in. All amounts in rupees.',
          ),
          ReportPdfStyle.tiles([
            ('Total orders', '${s.totalOrders}'),
            ('Delivered', '${s.deliveredCount}'),
            ('Cancelled', '${s.cancelledCount}'),
            ('Delivered value', ReportPdfStyle.amount(s.deliveredValue)),
            ('Billed', '${s.billedCount} . ${ReportPdfStyle.amount(s.billedValue)}'),
            ('Not yet billed', ReportPdfStyle.amount(s.unbilledDeliveredValue)),
          ], width: ReportPdfStyle.contentWidthPortrait, perRow: 3),
          pw.SizedBox(height: 10),

          ReportPdfStyle.subheading('By status'),
          ReportPdfStyle.table(
            columns: const [
              ReportPdfColumn('Status', flex: 3),
              ReportPdfColumn('Orders', flex: 1, align: pw.TextAlign.right),
            ],
            rows: [
              for (final status in _kOrderStatuses) [kOrderStatusLabel[status] ?? status, '${s.statusCount(status)}'],
            ],
            totals: ['Total', '${s.totalOrders}'],
          ),
          pw.SizedBox(height: 10),

          ReportPdfStyle.subheading('By source'),
          ReportPdfStyle.table(
            columns: const [
              ReportPdfColumn('Source', flex: 3),
              ReportPdfColumn('Orders', flex: 1, align: pw.TextAlign.right),
            ],
            rows: [
              for (final source in _kOrderSources) [kOrderSourceLabel[source] ?? source, '${s.bySource[source] ?? 0}'],
            ],
            totals: ['Total', '${s.totalOrders}'],
          ),
          pw.NewPage(),

          ReportPdfStyle.heading(
            'Register - ${report.orders.length} ${report.orders.length == 1 ? 'order' : 'orders'} placed $period',
            subtitle: 'Totals foot the rows above them',
          ),
          if (report.orders.isEmpty)
            pw.Text('No orders placed during this period.',
                style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            _registerTable(report),
        ],
      ),
    );

    return doc.save();
  }

  static pw.Widget _registerTable(FoodOrdersReport report) {
    return ReportPdfStyle.table(
      columns: const [
        ReportPdfColumn('Order', flex: 40),
        ReportPdfColumn('Placed', flex: 90),
        ReportPdfColumn('Source', flex: 46),
        ReportPdfColumn('Room/Tbl', flex: 48),
        ReportPdfColumn('Guest', flex: 90),
        ReportPdfColumn('Items', flex: 32, align: pw.TextAlign.right),
        ReportPdfColumn('Status', flex: 54),
        ReportPdfColumn('Bill no.', flex: 48),
        ReportPdfColumn('Amount', flex: 49, align: pw.TextAlign.right),
      ],
      fontSize: 7,
      rows: [
        for (final o in report.orders)
          [
            '#${o.orderNumber}',
            ReportPdfStyle.dateTime(DateTime.tryParse(o.placedAt) ?? DateTime.now()),
            kOrderSourceLabel[o.source] ?? o.source,
            _place(o),
            o.guestName ?? '—',
            '${o.itemCount}',
            kOrderStatusLabel[o.status] ?? o.status,
            o.invoiceNumber ?? '—',
            o.status == 'CANCELLED' ? '—' : ReportPdfStyle.amount(o.subtotal),
          ],
      ],
      totals: ['Total', '', '', '', '', '', '', '', ReportPdfStyle.amount(_totalAmount(report))],
    );
  }

  static String _place(ReportFoodOrderRow o) => o.roomNumber ?? o.tableLabel ?? '—';
}
