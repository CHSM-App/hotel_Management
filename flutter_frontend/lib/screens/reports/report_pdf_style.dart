import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

/// Shared look for every report PDF — mirrors bookingReportFile.js's
/// createLayout(): the same greys (a document that gets printed on a mono
/// laser, so a tint chosen for a screen would wash out), the same headings,
/// tiles and tables, so Bookings/Occupancy/GST read as one family even
/// though only Bookings has a web original to match exactly.
class ReportPdfStyle {
  ReportPdfStyle._();

  static const ink = PdfColor.fromInt(0xFF191919);
  static const muted = PdfColor.fromInt(0xFF737373);
  static const rule = PdfColor.fromInt(0xFFAAAAAA);
  static const band = PdfColor.fromInt(0xFFEEEEEE);
  static const zebra = PdfColor.fromInt(0xFFF7F7F7);

  static const margin = 24.0;

  /// jsPDF's built-in Helvetica has no Unicode glyphs and package:pdf's base14
  /// fonts are the same standard 14 — so the few non-Latin-1 characters the
  /// app's own strings carry (₹, en/em-dash, curly quotes) still have to be
  /// folded down. Mirrors BillPdf.ascii.
  static String ascii(String s) => s
      .replaceAll('₹', 'Rs.')
      .replaceAll(RegExp('[–—]'), '-')
      .replaceAll('·', '.')
      .replaceAll(RegExp('[‘’]'), "'")
      .replaceAll(RegExp('[“”]'), '"');

  /// Indian grouping, two decimals, "—" for null — mirrors formatAmount() in
  /// bookingReportFile.js.
  static String amount(num? n) {
    if (n == null) return '—';
    return NumberFormat('#,##,##0.00', 'en_IN').format(n);
  }

  static String count(num? n) => n == null ? '—' : n.toString();

  static String dateOnly(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final parts = iso.split('-');
    if (parts.length != 3) return iso;
    final months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    final m = int.tryParse(parts[1]);
    if (m == null || m < 1 || m > 12) return iso;
    return '${parts[2]} ${months[m - 1]} ${parts[0]}';
  }

  static String dateTime(DateTime value) {
    final months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    final local = value.toLocal();
    final time = DateFormat('h:mm a').format(local);
    return '${local.day.toString().padLeft(2, '0')} ${months[local.month - 1]} ${local.year}, $time';
  }

  /// The whole calendar month, or a from/to span — mirrors
  /// reportPeriodLabel()/wholeMonthLabel() in bookingReportFile.js.
  static String periodLabel(String fromDate, String toDate) {
    final whole = _wholeMonthLabel(fromDate, toDate);
    if (whole != null) return whole;
    return '${dateOnly(fromDate)} to ${dateOnly(toDate)}';
  }

  static String? _wholeMonthLabel(String fromDate, String toDate) {
    final f = fromDate.split('-').map(int.tryParse).toList();
    final t = toDate.split('-').map(int.tryParse).toList();
    if (f.length != 3 || t.length != 3 || f.any((e) => e == null) || t.any((e) => e == null)) {
      return null;
    }
    final fy = f[0]!, fm = f[1]!, fd = f[2]!;
    final ty = t[0]!, tm = t[1]!, td = t[2]!;
    if (fy != ty || fm != tm || fd != 1) return null;
    final lastDay = DateTime.utc(ty, tm + 1, 0).day;
    if (td != lastDay) return null;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[fm - 1]} $fy';
  }

  // ── Widgets ────────────────────────────────────────────────────────────

  /// Property on the left, document title/period/generated-at on the right —
  /// the same masthead shape every report PDF opens with.
  static pw.Widget masthead({
    required String name,
    String? gstin,
    required String title,
    required String subtitle,
    required DateTime generatedAt,
  }) {
    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.stretch,
      children: [
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    ascii(name.isEmpty ? 'Report' : name),
                    style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold, color: ink),
                  ),
                  if (gstin != null) ...[
                    pw.SizedBox(height: 3),
                    pw.Text('GSTIN  ${ascii(gstin)}', style: pw.TextStyle(fontSize: 8, color: muted)),
                  ],
                ],
              ),
            ),
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.end,
              children: [
                pw.Text(
                  ascii(title.toUpperCase()),
                  style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: ink),
                ),
                pw.SizedBox(height: 3),
                pw.Text(ascii(subtitle), style: pw.TextStyle(fontSize: 8, color: muted)),
                pw.SizedBox(height: 2),
                pw.Text('Generated ${dateTime(generatedAt)}', style: pw.TextStyle(fontSize: 8, color: muted)),
              ],
            ),
          ],
        ),
        pw.SizedBox(height: 10),
        pw.Container(height: 1.2, color: ink),
        pw.SizedBox(height: 12),
      ],
    );
  }

  static pw.Widget note(String text) => pw.Padding(
    padding: const pw.EdgeInsets.only(bottom: 10),
    child: pw.Text(
      ascii(text),
      style: pw.TextStyle(fontSize: 7, fontStyle: pw.FontStyle.italic, color: muted),
    ),
  );

  static pw.Widget heading(String text, {String? subtitle}) => pw.Column(
    crossAxisAlignment: pw.CrossAxisAlignment.stretch,
    children: [
      pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.end,
        children: [
          pw.Expanded(
            child: pw.Text(
              ascii(text.toUpperCase()),
              style: pw.TextStyle(fontSize: 9.5, fontWeight: pw.FontWeight.bold, color: ink),
            ),
          ),
          if (subtitle != null)
            pw.Text(ascii(subtitle), style: pw.TextStyle(fontSize: 7.5, color: muted)),
        ],
      ),
      pw.SizedBox(height: 4),
      pw.Container(height: 0.8, color: ink),
      pw.SizedBox(height: 10),
    ],
  );

  static pw.Widget subheading(String text) => pw.Padding(
    padding: const pw.EdgeInsets.only(bottom: 6),
    child: pw.Text(ascii(text), style: pw.TextStyle(fontSize: 8, fontWeight: pw.FontWeight.bold, color: ink)),
  );

  /// Label-above-value tiles — a handful of short facts where a full table
  /// would be all frame and no content.
  static pw.Widget tiles(List<(String, String)> entries, {int perRow = 3}) {
    return pw.Wrap(
      spacing: 4,
      runSpacing: 10,
      children: [
        for (final (label, value) in entries)
          pw.SizedBox(
            width: (1.0 / perRow) * 100,
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  ascii(label.toUpperCase()),
                  style: pw.TextStyle(fontSize: 6.5, color: muted),
                  maxLines: 1,
                  overflow: pw.TextOverflow.clip,
                ),
                pw.SizedBox(height: 2),
                pw.Text(
                  ascii(value),
                  style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold, color: ink),
                  maxLines: 1,
                  overflow: pw.TextOverflow.clip,
                ),
              ],
            ),
          ),
      ],
    );
  }

  /// A short arithmetic statement — "gross - discount = net" — as
  /// label/amount lines, the result ruled off from its parts. Mirrors
  /// layout.equation() in bookingReportFile.js.
  static pw.Widget equation(List<(String, String, bool)> lines, {double width = 260}) {
    return pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        for (final (label, value, result) in lines)
          pw.Container(
            width: width,
            padding: const pw.EdgeInsets.symmetric(vertical: 2),
            decoration: result
                ? const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(width: 0.6, color: rule)))
                : null,
            child: pw.Row(
              children: [
                pw.Expanded(
                  child: pw.Padding(
                    padding: pw.EdgeInsets.only(left: result ? 0 : 8),
                    child: pw.Text(
                      ascii(label),
                      style: pw.TextStyle(
                        fontSize: 8,
                        fontWeight: result ? pw.FontWeight.bold : pw.FontWeight.normal,
                        color: ink,
                      ),
                    ),
                  ),
                ),
                pw.Text(
                  ascii(value),
                  style: pw.TextStyle(
                    fontSize: 8,
                    fontWeight: result ? pw.FontWeight.bold : pw.FontWeight.normal,
                    color: ink,
                  ),
                ),
              ],
            ),
          ),
        pw.SizedBox(height: 6),
      ],
    );
  }

  /// A ruled table with a shaded header row, optional zebra striping and an
  /// optional bold totals row — mirrors layout.table() in
  /// bookingReportFile.js, built on pw.Table rather than a manual canvas.
  static pw.Widget table({
    required List<ReportPdfColumn> columns,
    required List<List<String>> rows,
    List<String>? totals,
    double fontSize = 8,
    bool zebra = true,
  }) {
    pw.TableRow headerRow() => pw.TableRow(
      decoration: const pw.BoxDecoration(color: band),
      children: [
        for (final c in columns)
          pw.Padding(
            padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 4),
            child: pw.Text(
              ascii(c.label),
              textAlign: c.align,
              style: pw.TextStyle(fontSize: fontSize, fontWeight: pw.FontWeight.bold, color: ink),
            ),
          ),
      ],
    );

    pw.TableRow bodyRow(List<String> cells, {bool shade = false, bool bold = false}) => pw.TableRow(
      decoration: shade ? const pw.BoxDecoration(color: zebraColor) : null,
      children: [
        for (var i = 0; i < columns.length; i++)
          pw.Padding(
            padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 3),
            child: pw.Text(
              ascii(i < cells.length ? cells[i] : ''),
              textAlign: columns[i].align,
              maxLines: 1,
              overflow: pw.TextOverflow.clip,
              style: pw.TextStyle(
                fontSize: fontSize,
                fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
                color: ink,
              ),
            ),
          ),
      ],
    );

    return pw.Table(
      columnWidths: {
        for (var i = 0; i < columns.length; i++) i: pw.FlexColumnWidth(columns[i].flex),
      },
      border: const pw.TableBorder(
        top: pw.BorderSide(width: 0.6, color: rule),
        bottom: pw.BorderSide(width: 0.6, color: rule),
        horizontalInside: pw.BorderSide(width: 0.3, color: rule),
      ),
      children: [
        headerRow(),
        for (var i = 0; i < rows.length; i++) bodyRow(rows[i], shade: zebra && i.isOdd),
        if (totals != null) bodyRow(totals, bold: true),
      ],
    );
  }

  static const zebraColor = zebra;
}

class ReportPdfColumn {
  final String label;
  final double flex;
  final pw.TextAlign align;

  const ReportPdfColumn(this.label, {this.flex = 1, this.align = pw.TextAlign.left});
}
