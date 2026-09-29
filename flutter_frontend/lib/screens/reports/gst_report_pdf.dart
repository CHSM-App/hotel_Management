import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'report_pdf_style.dart';

/// The GST filing summary as a real PDF. Web has no equivalent to match —
/// this invents a format consistent with [BookingReportPdf]'s style and with
/// what gst_report_panel.dart already shows on screen: the footed totals,
/// the split by document type, then every issued bill.
///
/// Portrait A4: the invoice list is a handful of columns, not the booking
/// register's nineteen.
class GstReportPdf {
  static Future<void> download(GstSummaryReport report, {String? lodgeName, String? gstin}) async {
    final bytes = await build(report, lodgeName: lodgeName, gstin: gstin);
    await saveBytesToDevice(bytes, _filename(report));
  }

  static Future<void> share(GstSummaryReport report, {String? lodgeName, String? gstin}) async {
    final bytes = await build(report, lodgeName: lodgeName, gstin: gstin);
    await shareBytesFromDevice(bytes, _filename(report));
  }

  static Future<void> print(GstSummaryReport report, {String? lodgeName, String? gstin}) async {
    final bytes = await build(report, lodgeName: lodgeName, gstin: gstin);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static String _filename(GstSummaryReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    return 'GST-summary-$period.pdf';
  }

  static Future<Uint8List> build(GstSummaryReport report, {String? lodgeName, String? gstin}) async {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate);
    final name = (lodgeName?.isNotEmpty ?? false) ? lodgeName! : 'GST summary';
    final generatedAt = DateTime.now();
    final runningHead = '${ReportPdfStyle.ascii(name)} - GST summary, $period';
    final totals = report.totals;
    const types = ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'CASH_RECEIPT'];

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
                    ReportPdfStyle.ascii('$name . GST summary, $period . All amounts in Rs.'),
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
            gstin: gstin,
            title: 'GST summary',
            subtitle: period,
            generatedAt: generatedAt,
          ),
          ReportPdfStyle.note(
            'A filing summary, not a GSTR-1 export - invoice-wise totals grouped by document type, the shape a '
            'return is filled in from. Void bills are excluded; they carry no tax liability.',
          ),
          ReportPdfStyle.tiles([
            ('Bills issued', '${totals.count}'),
            ('Room charges', ReportPdfStyle.amount(totals.roomSubtotal)),
            ('CGST', ReportPdfStyle.amount(totals.cgstAmount)),
            ('SGST', ReportPdfStyle.amount(totals.sgstAmount)),
            ('Total revenue', ReportPdfStyle.amount(totals.totalAmount)),
          ], perRow: 3),
          pw.SizedBox(height: 16),
          if (report.byDocumentType.isNotEmpty) ...[
            ReportPdfStyle.heading('By document type'),
            ReportPdfStyle.table(
              columns: const [
                ReportPdfColumn('Document', flex: 2),
                ReportPdfColumn('Bills', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Taxable', flex: 1.3, align: pw.TextAlign.right),
                ReportPdfColumn('CGST', flex: 1.2, align: pw.TextAlign.right),
                ReportPdfColumn('SGST', flex: 1.2, align: pw.TextAlign.right),
                ReportPdfColumn('Total', flex: 1.4, align: pw.TextAlign.right),
              ],
              rows: [
                for (final type in types)
                  if ((report.byDocumentType[type]?.count ?? 0) > 0)
                    _docRow(kDocumentTypeLabel[type] ?? type, report.byDocumentType[type]!),
              ],
              totals: [
                'Total',
                '${totals.count}',
                ReportPdfStyle.amount(totals.roomSubtotal),
                ReportPdfStyle.amount(totals.cgstAmount),
                ReportPdfStyle.amount(totals.sgstAmount),
                ReportPdfStyle.amount(totals.totalAmount),
              ],
            ),
            pw.SizedBox(height: 16),
          ],
          ReportPdfStyle.heading('Bills', subtitle: '${report.invoices.length} bills'),
          if (report.invoices.isEmpty)
            pw.Text('No bills issued in this date range.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            ReportPdfStyle.table(
              columns: const [
                ReportPdfColumn('Bill no.', flex: 1.4),
                ReportPdfColumn('Document', flex: 1.3),
                ReportPdfColumn('Guest', flex: 1.6),
                ReportPdfColumn('Date', flex: 1.1),
                ReportPdfColumn('CGST', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('SGST', flex: 1, align: pw.TextAlign.right),
                ReportPdfColumn('Total', flex: 1.2, align: pw.TextAlign.right),
              ],
              rows: [
                for (final inv in report.invoices)
                  [
                    inv.invoiceNumber ?? '—',
                    kDocumentTypeLabel[inv.documentType] ?? inv.documentType ?? '—',
                    inv.guestName ?? '—',
                    _dateOfTimestamp(inv.createdAt),
                    ReportPdfStyle.amount(inv.cgstAmount),
                    ReportPdfStyle.amount(inv.sgstAmount),
                    ReportPdfStyle.amount(inv.totalAmount),
                  ],
              ],
              totals: [
                'Total', '', '', '',
                ReportPdfStyle.amount(totals.cgstAmount),
                ReportPdfStyle.amount(totals.sgstAmount),
                ReportPdfStyle.amount(totals.totalAmount),
              ],
            ),
        ],
      ),
    );

    return doc.save();
  }

  static List<String> _docRow(String label, GstDocumentTotals t) => [
    label,
    '${t.count}',
    ReportPdfStyle.amount(t.roomSubtotal),
    ReportPdfStyle.amount(t.cgstAmount),
    ReportPdfStyle.amount(t.sgstAmount),
    ReportPdfStyle.amount(t.totalAmount),
  ];

  static String _dateOfTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final d = DateTime.tryParse(iso)?.toLocal();
    if (d == null) return iso;
    return ReportPdfStyle.dateOnly(
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
    );
  }
}
