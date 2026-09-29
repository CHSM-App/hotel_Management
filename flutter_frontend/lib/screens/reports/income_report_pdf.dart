import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/income.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'report_pdf_style.dart';

/// One totals object the on-screen tab, this PDF's tiles and
/// [IncomeReportExcel]'s summary sheet all read from, so the three views can
/// never disagree on a figure — mirrors computeTotals() in
/// incomeReportFile.js.
class IncomeTotals {
  final int count;
  final num total;
  final num received;
  final num outstanding;
  final Map<String, num> byStatus;

  const IncomeTotals({
    this.count = 0,
    this.total = 0,
    this.received = 0,
    this.outstanding = 0,
    this.byStatus = const {},
  });
}

IncomeTotals computeIncomeTotals(List<IncomeEntry> income) {
  final total = income.fold<num>(0, (s, e) => s + e.amount);
  final received = income.fold<num>(0, (s, e) => s + (e.amountReceived ?? 0));
  final byStatus = <String, num>{'PAID': 0, 'PARTIAL': 0, 'PENDING': 0};
  for (final e in income) {
    final key = byStatus.containsKey(e.paymentStatus) ? e.paymentStatus : 'PAID';
    byStatus[key] = (byStatus[key] ?? 0) + e.amount;
  }
  return IncomeTotals(count: income.length, total: total, received: received, outstanding: total - received, byStatus: byStatus);
}

/// A label with its total and how many entries fed it — mirrors
/// groupByCategory()/groupByPayer() in incomeReportFile.js.
class IncomeGroup {
  final String label;
  final num total;
  final int count;

  const IncomeGroup({required this.label, this.total = 0, this.count = 0});
}

List<IncomeGroup> groupIncomeByCategory(List<IncomeEntry> income) {
  final map = <String, (num, int)>{};
  for (final e in income) {
    final key = e.categoryName.isEmpty ? 'Uncategorised' : e.categoryName;
    final (t, c) = map[key] ?? (0, 0);
    map[key] = (t + e.amount, c + 1);
  }
  final groups = [for (final entry in map.entries) IncomeGroup(label: entry.key, total: entry.value.$1, count: entry.value.$2)];
  groups.sort((a, b) => b.total.compareTo(a.total));
  return groups;
}

List<IncomeGroup> groupIncomeByPayer(List<IncomeEntry> income) {
  final map = <String, (num, int)>{};
  for (final e in income) {
    final key = e.payerName?.isNotEmpty == true ? e.payerName! : 'No payer on file';
    final (t, c) = map[key] ?? (0, 0);
    map[key] = (t + e.amount, c + 1);
  }
  final groups = [for (final entry in map.entries) IncomeGroup(label: entry.key, total: entry.value.$1, count: entry.value.$2)];
  groups.sort((a, b) => b.total.compareTo(a.total));
  return groups;
}

// Full status vocabulary in display order, PAID included — kIncomeStatusLabel
// (in income.dart) only carries PARTIAL/PENDING since PAID/"Received" is the
// common default elsewhere. Mirrors PAYMENT_STATUS_LABEL in
// incomeReportFile.js.
const _kIncomeStatuses = ['PAID', 'PARTIAL', 'PENDING'];
String _incomeStatusLabel(String status) =>
    status == 'PAID' ? 'Received' : (kIncomeStatusLabel[status] ?? 'Received');

/// The other-income register as a real PDF — the native equivalent of
/// frontend/src/pages/lodge/incomeReportFile.js's buildIncomeReportPdf():
/// masthead, headline tiles, "By status" and "Top categories" tables, then a
/// new page with the full register.
///
/// Portrait A4, same as the web version — the register is seven columns,
/// not the booking register's nineteen.
class IncomeReportPdf {
  static Future<String> download(List<IncomeEntry> income, {String? lodgeName}) async {
    final bytes = await build(income, lodgeName: lodgeName);
    return saveBytesToDevice(bytes, filenameFor('pdf'));
  }

  static Future<void> share(List<IncomeEntry> income, {String? lodgeName}) async {
    final bytes = await build(income, lodgeName: lodgeName);
    await shareBytesFromDevice(bytes, filenameFor('pdf'));
  }

  static Future<void> print(List<IncomeEntry> income, {String? lodgeName}) async {
    final bytes = await build(income, lodgeName: lodgeName);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  // Full history, not a date range, so the filename is stamped by when it
  // was generated — mirrors reportFilename() in incomeReportFile.js. Shared
  // with [IncomeReportExcel] so the two extensions of the same report agree
  // on a name.
  static String filenameFor(String extension) {
    final now = DateTime.now();
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return 'Income-report-${months[now.month - 1]}-${now.year}.$extension';
  }

  static Future<Uint8List> build(List<IncomeEntry> income, {String? lodgeName}) async {
    final totals = computeIncomeTotals(income);
    final name = (lodgeName?.isNotEmpty ?? false) ? lodgeName! : 'Income report';
    final generatedAt = DateTime.now();
    final runningHead = '${ReportPdfStyle.ascii(name)} - income report';

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
                    ReportPdfStyle.ascii('$name . Income report . All amounts in Rs.'),
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
            title: 'Income report',
            subtitle: 'All income on file',
            generatedAt: generatedAt,
          ),
          ReportPdfStyle.tiles([
            ('Entries logged', ReportPdfStyle.count(totals.count)),
            ('Total income', ReportPdfStyle.amount(totals.total)),
            ('Received so far', ReportPdfStyle.amount(totals.received)),
            ('Outstanding', ReportPdfStyle.amount(totals.outstanding)),
          ], width: ReportPdfStyle.contentWidthPortrait, perRow: 4),
          pw.SizedBox(height: 14),
          ReportPdfStyle.heading('By status'),
          ReportPdfStyle.table(
            columns: const [
              ReportPdfColumn('Status', flex: 2.4),
              ReportPdfColumn('Amount', flex: 1.4, align: pw.TextAlign.right),
            ],
            rows: [
              for (final status in _kIncomeStatuses)
                [_incomeStatusLabel(status), ReportPdfStyle.amount(totals.byStatus[status] ?? 0)],
            ],
          ),
          pw.SizedBox(height: 14),
          ReportPdfStyle.heading('Top categories'),
          ReportPdfStyle.table(
            columns: const [
              ReportPdfColumn('Category', flex: 3),
              ReportPdfColumn('Entries', flex: 1, align: pw.TextAlign.right),
              ReportPdfColumn('Amount', flex: 1.4, align: pw.TextAlign.right),
            ],
            rows: [
              for (final g in groupIncomeByCategory(income).take(10))
                [g.label, ReportPdfStyle.count(g.count), ReportPdfStyle.amount(g.total)],
            ],
          ),
          pw.NewPage(),
          ReportPdfStyle.heading('Register - ${totals.count} ${totals.count == 1 ? 'entry' : 'entries'}'),
          if (income.isEmpty)
            pw.Text('No income logged.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            ReportPdfStyle.table(
              columns: const [
                ReportPdfColumn('Date', flex: 1.1),
                ReportPdfColumn('Title', flex: 2.4),
                ReportPdfColumn('Category', flex: 1.6),
                ReportPdfColumn('Payer', flex: 1.8),
                ReportPdfColumn('Received via', flex: 1.2),
                ReportPdfColumn('Status', flex: 1.1),
                ReportPdfColumn('Amount', flex: 1.3, align: pw.TextAlign.right),
              ],
              fontSize: 7.5,
              rows: [
                for (final e in income)
                  [
                    ReportPdfStyle.dateOnly(e.incomeDate),
                    e.title,
                    e.categoryName.isEmpty ? '—' : e.categoryName,
                    e.payerName?.isNotEmpty == true ? e.payerName! : '—',
                    kPaymentMethodLabel[e.paymentMethod] ?? e.paymentMethod,
                    _incomeStatusLabel(e.paymentStatus),
                    ReportPdfStyle.amount(e.amount),
                  ],
              ],
              totals: ['Total', '', '', '', '', '', ReportPdfStyle.amount(totals.total)],
            ),
        ],
      ),
    );

    return doc.save();
  }
}
