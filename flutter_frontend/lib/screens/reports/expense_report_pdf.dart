import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/expense.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'report_pdf_style.dart';

/// One totals object the on-screen tab, this PDF's tiles and
/// [ExpenseReportExcel]'s summary sheet all read from, so the three views can
/// never disagree on a figure — mirrors computeTotals() in
/// expenseReportFile.js.
class ExpenseTotals {
  final int count;
  final num total;
  final num paid;
  final num outstanding;
  final Map<String, num> byStatus;

  const ExpenseTotals({
    this.count = 0,
    this.total = 0,
    this.paid = 0,
    this.outstanding = 0,
    this.byStatus = const {},
  });
}

ExpenseTotals computeExpenseTotals(List<Expense> expenses) {
  final total = expenses.fold<num>(0, (s, e) => s + e.amount);
  final paid = expenses.fold<num>(0, (s, e) => s + (e.amountPaid ?? 0));
  final byStatus = <String, num>{'PAID': 0, 'PARTIAL': 0, 'PENDING': 0};
  for (final e in expenses) {
    final key = byStatus.containsKey(e.paymentStatus) ? e.paymentStatus : 'PAID';
    byStatus[key] = (byStatus[key] ?? 0) + e.amount;
  }
  return ExpenseTotals(count: expenses.length, total: total, paid: paid, outstanding: total - paid, byStatus: byStatus);
}

/// A label with its total and how many expenses fed it — mirrors
/// groupByCategory()/groupByVendor() in expenseReportFile.js.
class ExpenseGroup {
  final String label;
  final num total;
  final int count;

  const ExpenseGroup({required this.label, this.total = 0, this.count = 0});
}

List<ExpenseGroup> groupExpensesByCategory(List<Expense> expenses) {
  final map = <String, (num, int)>{};
  for (final e in expenses) {
    final key = e.categoryName.isEmpty ? 'Uncategorised' : e.categoryName;
    final (t, c) = map[key] ?? (0, 0);
    map[key] = (t + e.amount, c + 1);
  }
  final groups = [for (final entry in map.entries) ExpenseGroup(label: entry.key, total: entry.value.$1, count: entry.value.$2)];
  groups.sort((a, b) => b.total.compareTo(a.total));
  return groups;
}

List<ExpenseGroup> groupExpensesByVendor(List<Expense> expenses) {
  final map = <String, (num, int)>{};
  for (final e in expenses) {
    final key = e.vendorName?.isNotEmpty == true ? e.vendorName! : 'No vendor on file';
    final (t, c) = map[key] ?? (0, 0);
    map[key] = (t + e.amount, c + 1);
  }
  final groups = [for (final entry in map.entries) ExpenseGroup(label: entry.key, total: entry.value.$1, count: entry.value.$2)];
  groups.sort((a, b) => b.total.compareTo(a.total));
  return groups;
}

// Full status vocabulary in display order — kPaymentStatusLabel (in
// expense.dart) only carries PARTIAL/PENDING since PAID is the common
// default elsewhere; this report prints every status explicitly, so it needs
// PAID's label too. Mirrors PAYMENT_STATUS_LABEL in expenseReportFile.js.
const _kExpenseStatuses = ['PAID', 'PARTIAL', 'PENDING'];
String _expenseStatusLabel(String status) =>
    status == 'PAID' ? 'Paid' : (kPaymentStatusLabel[status] ?? 'Paid');

/// The expense register as a real PDF — the native equivalent of
/// frontend/src/pages/lodge/expenseReportFile.js's buildExpensesReportPdf():
/// masthead, headline tiles, "By status" and "Top categories" tables, then a
/// new page with the full register.
///
/// Portrait A4, same as the web version — the register is seven columns,
/// not the booking register's nineteen.
class ExpenseReportPdf {
  static Future<void> download(List<Expense> expenses, {String? lodgeName}) async {
    final bytes = await build(expenses, lodgeName: lodgeName);
    await saveBytesToDevice(bytes, filenameFor('pdf'));
  }

  static Future<void> share(List<Expense> expenses, {String? lodgeName}) async {
    final bytes = await build(expenses, lodgeName: lodgeName);
    await shareBytesFromDevice(bytes, filenameFor('pdf'));
  }

  static Future<void> print(List<Expense> expenses, {String? lodgeName}) async {
    final bytes = await build(expenses, lodgeName: lodgeName);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  // Full history, not a date range, so the filename is stamped by when it
  // was generated — mirrors reportFilename() in expenseReportFile.js. Shared
  // with [ExpenseReportExcel] so the two extensions of the same report agree
  // on a name.
  static String filenameFor(String extension) {
    final now = DateTime.now();
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return 'Expense-report-${months[now.month - 1]}-${now.year}.$extension';
  }

  static Future<Uint8List> build(List<Expense> expenses, {String? lodgeName}) async {
    final totals = computeExpenseTotals(expenses);
    final name = (lodgeName?.isNotEmpty ?? false) ? lodgeName! : 'Expense report';
    final generatedAt = DateTime.now();
    final runningHead = '${ReportPdfStyle.ascii(name)} - expense report';

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
                    ReportPdfStyle.ascii('$name . Expense report . All amounts in Rs.'),
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
            title: 'Expense report',
            subtitle: 'All expenses on file',
            generatedAt: generatedAt,
          ),
          ReportPdfStyle.tiles([
            ('Expenses logged', ReportPdfStyle.count(totals.count)),
            ('Total spend', ReportPdfStyle.amount(totals.total)),
            ('Paid so far', ReportPdfStyle.amount(totals.paid)),
            ('Outstanding', ReportPdfStyle.amount(totals.outstanding)),
          ], perRow: 4),
          pw.SizedBox(height: 14),
          ReportPdfStyle.heading('By status'),
          ReportPdfStyle.table(
            columns: const [
              ReportPdfColumn('Status', flex: 2.4),
              ReportPdfColumn('Amount', flex: 1.4, align: pw.TextAlign.right),
            ],
            rows: [
              for (final status in _kExpenseStatuses)
                [_expenseStatusLabel(status), ReportPdfStyle.amount(totals.byStatus[status] ?? 0)],
            ],
          ),
          pw.SizedBox(height: 14),
          ReportPdfStyle.heading('Top categories'),
          ReportPdfStyle.table(
            columns: const [
              ReportPdfColumn('Category', flex: 3),
              ReportPdfColumn('Expenses', flex: 1, align: pw.TextAlign.right),
              ReportPdfColumn('Amount', flex: 1.4, align: pw.TextAlign.right),
            ],
            rows: [
              for (final g in groupExpensesByCategory(expenses).take(10))
                [g.label, ReportPdfStyle.count(g.count), ReportPdfStyle.amount(g.total)],
            ],
          ),
          pw.NewPage(),
          ReportPdfStyle.heading('Register - ${totals.count} ${totals.count == 1 ? 'expense' : 'expenses'}'),
          if (expenses.isEmpty)
            pw.Text('No expenses logged.', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
          else
            ReportPdfStyle.table(
              columns: const [
                ReportPdfColumn('Date', flex: 1.1),
                ReportPdfColumn('Title', flex: 2.4),
                ReportPdfColumn('Category', flex: 1.6),
                ReportPdfColumn('Vendor', flex: 1.8),
                ReportPdfColumn('Paid via', flex: 1.2),
                ReportPdfColumn('Status', flex: 1.1),
                ReportPdfColumn('Amount', flex: 1.3, align: pw.TextAlign.right),
              ],
              fontSize: 7.5,
              rows: [
                for (final e in expenses)
                  [
                    ReportPdfStyle.dateOnly(e.expenseDate),
                    e.title,
                    e.categoryName.isEmpty ? '—' : e.categoryName,
                    e.vendorName?.isNotEmpty == true ? e.vendorName! : '—',
                    kPaymentMethodLabel[e.paymentMethod] ?? e.paymentMethod,
                    _expenseStatusLabel(e.paymentStatus),
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
