import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/me.dart';
import '../../domain/models/saved_quotation.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import '../reports/report_pdf_style.dart';
import 'quotation_pdf.dart';
import 'quote_common.dart';

/// The quotation letter for an event, food or bar quotation — built from the
/// frozen `details` the server saved, so it reads exactly as it was quoted.
/// Same letterhead and look as [QuotationPdf] (the room letter).
class QuotationDocPdf {
  static Future<String> download(SavedQuotation q, {required Lodge? lodge, String? preparedBy}) async =>
      saveBytesToDevice(await build(q, lodge: lodge, preparedBy: preparedBy), '${q.referenceCode}.pdf');

  static Future<void> share(SavedQuotation q, {required Lodge? lodge, String? preparedBy}) async =>
      shareBytesFromDevice(await build(q, lodge: lodge, preparedBy: preparedBy), '${q.referenceCode}.pdf');

  static Future<void> print(SavedQuotation q, {required Lodge? lodge, String? preparedBy}) async {
    final bytes = await build(q, lodge: lodge, preparedBy: preparedBy);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static num _n(dynamic v) => v is num ? v : num.tryParse('$v') ?? 0;

  /// What one part of a combined quotation comes to, read off its frozen payload.
  static num _partTotal(String kind, dynamic payload) {
    if (kind == 'ROOM') {
      return (payload as List? ?? const []).fold<num>(0, (sum, r) => sum + _n(((r as Map)['result'] as Map?)?['total']));
    }
    final d = payload as Map? ?? const {};
    return kind == 'EVENT' ? _n((d['pricing'] as Map?)?['totalAmount']) : _n(d['total']);
  }

  /// Table rows, the facts strip and the totals for the quotation's kind.
  static ({
    String title,
    List<(String, String)> facts,
    List<ReportPdfColumn> columns,
    List<List<String>> rows,
    List<(String, String, bool)> totals,
    String? note,
    List<String> terms,
  })
  _content(String kind, dynamic payload, SavedQuotation q, num total) {
    final d = payload is Map ? Map<String, dynamic>.from(payload) : <String, dynamic>{};
    final note = d['note']?.toString();
    String when(String? iso) {
      final t = DateTime.tryParse(iso ?? '')?.toLocal();
      if (t == null) return '';
      final hh = t.hour.toString().padLeft(2, '0');
      final mm = t.minute.toString().padLeft(2, '0');
      return '${ReportPdfStyle.dateOnly(t.toIso8601String().substring(0, 10))} $hh:$mm';
    }

    if (kind == 'ROOM') {
      final rooms = [for (final r in (payload as List? ?? const [])) Map<String, dynamic>.from(r as Map)];
      final rows = <List<String>>[];
      for (final r in rooms) {
        final res = Map<String, dynamic>.from((r['result'] as Map?) ?? const {});
        rows.add([
          'Room ${r['roomNumber']}${'${r['categoryName'] ?? ''}'.isEmpty ? '' : ' . ${r['categoryName']}'}',
          '${ReportPdfStyle.dateOnly('${r['fromDate']}')} to ${ReportPdfStyle.dateOnly('${r['toDate']}')}',
          '',
        ]);
        for (final l in (res['lines'] as List? ?? const [])) {
          final lm = Map<String, dynamic>.from(l as Map);
          rows.add(['   ${lm['label']}', '', ReportPdfStyle.amount(_n(lm['amount']))]);
        }
        rows.add(['   Room total', '', ReportPdfStyle.amount(_n(res['total']))]);
      }
      return (
        title: 'Room stay',
        facts: [('Rooms', '${rooms.length}')],
        columns: const [
          ReportPdfColumn('Room and charges', flex: 3),
          ReportPdfColumn('Dates', flex: 2),
          ReportPdfColumn('Amount', flex: 1, align: pw.TextAlign.right),
        ],
        rows: rows,
        totals: [('Total', ReportPdfStyle.amount(total), true)],
        note: null,
        terms: const [
          'This quotation is valid only for the rooms and dates mentioned above.',
          'Rates are as on the date of this quotation and may change.',
          'It is a quotation only. It does not confirm or hold a booking.',
          'Rooms are subject to availability at the time of booking.',
        ],
      );
    }
    if (kind == 'EVENT') {
      final pricing = Map<String, dynamic>.from((d['pricing'] as Map?) ?? const {});
      final input = Map<String, dynamic>.from((d['input'] as Map?) ?? const {});
      final lines = ((pricing['lines'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map));
      final gross = _n(pricing['grossAmount']);
      final discount = _n(pricing['discountAmount']);
      return (
        title: 'Event quotation',
        facts: [
          ('Venue', d['venueName']?.toString() ?? ''),
          ('Starts', when(input['startAt']?.toString())),
          ('Ends', when(input['endAt']?.toString())),
          ('Guests', '${_n(pricing['billablePax']).toInt()}'),
        ],
        columns: const [
          ReportPdfColumn('Description', flex: 3),
          ReportPdfColumn('Detail', flex: 2),
          ReportPdfColumn('Amount', flex: 1, align: pw.TextAlign.right),
        ],
        rows: [
          for (final l in lines) [l['label']?.toString() ?? '', l['note']?.toString() ?? '', ReportPdfStyle.amount(_n(l['amount']))],
        ],
        totals: [
          if (discount > 0) ('Total before concession', ReportPdfStyle.amount(gross), false),
          if (discount > 0) ('Concession', '- ${ReportPdfStyle.amount(discount)}', false),
          ('Total', ReportPdfStyle.amount(total), true),
        ],
        note: note,
        terms: const [
          'This quotation is for the venue, date and time mentioned above.',
          'It is a quotation only. It does not confirm or hold the venue.',
          'The venue is confirmed only after a booking is made and an advance is received.',
          'Any change in date, time, guest count or add-ons will change the amount.',
          'Services not listed above are charged separately.',
        ],
      );
    }

    final lines = ((d['lines'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map));
    final discount = _n(d['discount']);
    final isBar = kind == 'BAR';
    final taxPercent = _n(d['taxPercent']);
    return (
      title: isBar ? 'Bar quotation' : 'Food quotation',
      facts: [
        ('Items', '${lines.length}'),
        ('Valid until', ReportPdfStyle.dateOnly(q.validUntil)),
      ],
      columns: const [
        ReportPdfColumn('Item', flex: 3),
        ReportPdfColumn('Rate', flex: 1, align: pw.TextAlign.right),
        ReportPdfColumn('Qty', flex: 1, align: pw.TextAlign.right),
        ReportPdfColumn('Amount', flex: 1, align: pw.TextAlign.right),
      ],
      rows: [
        for (final l in lines)
          [
            l['itemName']?.toString() ?? '',
            ReportPdfStyle.amount(_n(l['unitPrice'])),
            '${_n(l['quantity']).toInt()}',
            ReportPdfStyle.amount(_n(l['lineTotal'])),
          ],
      ],
      totals: [
        ('Subtotal', ReportPdfStyle.amount(_n(d['subtotal'])), false),
        if (discount > 0) ('Discount', '- ${ReportPdfStyle.amount(discount)}', false),
        ('Total', ReportPdfStyle.amount(total), true),
      ],
      note: note,
      terms: [
        'Prices are as on the date of this quotation and may change.',
        if (isBar && taxPercent > 0) 'Prices include tax.',
        'This is a quotation only. It is not a bill.',
        'Items are subject to availability at the time of the order.',
      ],
    );
  }

  static Future<Uint8List> build(SavedQuotation q, {required Lodge? lodge, String? preparedBy}) async {
    final logo = await QuotationPdf.fetchLogo(lodge?.logoUrl);
    final name = (lodge?.name.isNotEmpty ?? false) ? lodge!.name : 'Quotation';
    final address = [lodge?.address, lodge?.city, lodge?.state].whereType<String>().where((s) => s.isNotEmpty).join(', ');
    final contact = [
      if (lodge?.phone?.isNotEmpty ?? false) 'Phone ${lodge!.phone}',
      if ((lodge?.isGstRegistered ?? false) && (lodge?.gstin?.isNotEmpty ?? false)) 'GSTIN ${lodge!.gstin}',
    ].join(' . ');
    final now = DateTime.now();
    final date = ReportPdfStyle.dateOnly('${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}');
    // One section per part for a combined quotation; a single one otherwise.
    final parts = Map<String, dynamic>.from((q.details['parts'] as Map?) ?? const {});
    final combined = q.kind == 'COMBINED';
    final sections = combined
        ? [
            for (final (k, _, _) in kQuotationKinds)
              if (parts.containsKey(k)) _content(k, parts[k], q, _partTotal(k, parts[k])),
          ]
        : [_content(q.kind, q.kind == 'ROOM' ? null : q.details, q, q.total)];
    final terms = {for (final c in sections) ...c.terms}.toList();
    final guest = [q.guestName ?? '', q.guestPhone ?? ''].where((s) => s.trim().isNotEmpty);

    final doc = pw.Document();
    doc.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4.copyWith(
          marginLeft: ReportPdfStyle.margin,
          marginRight: ReportPdfStyle.margin,
          marginTop: ReportPdfStyle.margin,
          marginBottom: ReportPdfStyle.margin + 16,
        ),
        footer: (context) => pw.Row(
          children: [
            pw.Expanded(
              child: pw.Text(
                ReportPdfStyle.ascii('$name . ${q.referenceCode} . dated $date'),
                style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted),
              ),
            ),
            pw.Text('Page ${context.pageNumber} of ${context.pagesCount}', style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted)),
          ],
        ),
        build: (context) => [
          QuotationPdf.letterhead(name, address, contact, logo, date, preparedBy),
          pw.SizedBox(height: 14),
          pw.Container(height: 1.2, color: ReportPdfStyle.ink),
          pw.SizedBox(height: 14),
          if (guest.isNotEmpty) QuotationPdf.preparedFor(q.guestName, q.guestPhone),
          pw.Text(
            ReportPdfStyle.ascii('${combined ? 'Combined quotation' : sections.first.title} . ${q.referenceCode}'),
            style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.ink),
          ),
          pw.SizedBox(height: 8),
          for (final c in sections) ...[
            if (combined)
              pw.Padding(
                padding: const pw.EdgeInsets.only(top: 6, bottom: 4),
                child: pw.Text(ReportPdfStyle.ascii(c.title.toUpperCase()), style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.muted)),
              ),
            ReportPdfStyle.tiles(c.facts, width: ReportPdfStyle.contentWidthPortrait, perRow: c.facts.length.clamp(1, 4)),
            pw.SizedBox(height: 10),
            ReportPdfStyle.table(columns: c.columns, rows: c.rows),
            pw.SizedBox(height: 8),
            pw.Align(alignment: pw.Alignment.centerRight, child: ReportPdfStyle.equation(c.totals)),
            if (c.note != null && c.note!.isNotEmpty)
              pw.Text(ReportPdfStyle.ascii('Note: ${c.note}'), style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted)),
            pw.SizedBox(height: 10),
          ],
          if (combined)
            pw.Align(
              alignment: pw.Alignment.centerRight,
              child: ReportPdfStyle.equation([('Grand total', ReportPdfStyle.amount(q.total), true)], width: 220),
            ),
          pw.SizedBox(height: 10),
          pw.Text('Terms', style: pw.TextStyle(fontSize: 8, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.ink)),
          pw.SizedBox(height: 3),
          for (final t in terms)
            pw.Padding(
              padding: const pw.EdgeInsets.only(bottom: 2),
              child: pw.Text(ReportPdfStyle.ascii('- $t'), style: pw.TextStyle(fontSize: 7.5, color: ReportPdfStyle.muted)),
            ),
          pw.SizedBox(height: 24),
          pw.Align(
            alignment: pw.Alignment.centerRight,
            child: pw.Column(
              children: [
                pw.SizedBox(width: 120, height: 30),
                pw.Container(width: 120, height: 0.6, color: ReportPdfStyle.ink),
                pw.SizedBox(height: 3),
                pw.Text(ReportPdfStyle.ascii('For $name'), style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold)),
                pw.Text('Authorised signatory', style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted)),
              ],
            ),
          ),
        ],
      ),
    );
    return doc.save();
  }
}
