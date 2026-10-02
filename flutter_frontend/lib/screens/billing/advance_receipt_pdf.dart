import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../core/constant.dart';
import '../../domain/models/booking.dart' show PaymentLine;
import '../../domain/models/invoice.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'bill_pdf.dart' show kPayLabels;

/// The advance receipt, as the property's own voucher — ruled lines on a
/// pad, the same shape BillPdf draws for the bill itself, just shorter:
/// money taken before the bill exists, adjusted against it later. Mirrors
/// AdvanceReceiptDocument.jsx line for line.
class AdvanceReceiptPdf {
  static Future<void> print(AdvanceReceipt receipt, {String? lodgeName}) async {
    final bytes = await build(receipt, lodgeName: lodgeName);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static Future<String> download(AdvanceReceipt receipt, {String? lodgeName}) async {
    final bytes = await build(receipt, lodgeName: lodgeName);
    final safe = (receipt.receiptNumber ?? '${receipt.id}').replaceAll(RegExp(r'[\\/]'), '-');
    return saveBytesToDevice(bytes, '$safe.pdf');
  }

  static Future<void> share(AdvanceReceipt receipt, {String? lodgeName}) async {
    final bytes = await build(receipt, lodgeName: lodgeName);
    final safe = (receipt.receiptNumber ?? '${receipt.id}').replaceAll(RegExp(r'[\\/]'), '-');
    await shareBytesFromDevice(bytes, '$safe.pdf');
  }

  static Future<Uint8List> build(AdvanceReceipt receipt, {String? lodgeName, bool compress = true}) async {
    final doc = pw.Document(compress: compress);
    final logo = await _fetchLogo(receipt.lodgeLogoUrl);
    doc.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a6.copyWith(marginTop: 16, marginBottom: 16, marginLeft: 16, marginRight: 16),
        build: (context) => _voucher(receipt, lodgeName, logo),
      ),
    );
    return doc.save();
  }

  /// Same best-effort fetch BillPdf uses — null on no logo, no permission to
  /// print it, or a failed fetch, and the voucher prints without one either
  /// way.
  static Future<Uint8List?> _fetchLogo(String? url) async {
    if (url == null) return null;
    try {
      final res = await Dio().get<List<int>>(
        '$baseUrl$url',
        options: Options(responseType: ResponseType.bytes),
      );
      final data = res.data;
      return data == null ? null : Uint8List.fromList(data);
    } catch (_) {
      return null;
    }
  }

  /// Fold the few non-Latin-1 characters this voucher's own strings carry
  /// down to what the standard PDF fonts can draw — same rule BillPdf uses.
  static String _ascii(String s) => s
      .replaceAll('₹', 'Rs.')
      .replaceAll(RegExp('[–—]'), '-')
      .replaceAll('·', '.')
      .replaceAll(RegExp('[‘’]'), "'")
      .replaceAll(RegExp('[“”]'), '"');

  static pw.Widget _voucher(AdvanceReceipt r, String? fallbackName, Uint8List? logo) {
    final isGst = r.billingSide == 'GST';
    final name = r.lodgeName ?? fallbackName ?? '';
    final isEvent = r.isEventReceipt;
    final tenders = r.paymentLines.isNotEmpty
        ? r.paymentLines
        : (r.paymentMethod != null
              ? [PaymentLine(method: r.paymentMethod!, amount: r.amountReceived, reference: r.paymentReference)]
              : const <PaymentLine>[]);
    final singleMethod = tenders.length == 1 ? tenders.first.method : null;
    final singleRef = tenders.length == 1 ? tenders.first.reference : null;

    return pw.Container(
      decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.8)),
      padding: const pw.EdgeInsets.all(8),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          // ── Masthead ────────────────────────────────────────────────────
          pw.Stack(
            children: [
              pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.stretch,
                children: [
                  pw.Row(
                    children: [
                      pw.Expanded(
                        child: pw.Text(
                          'Receipt Voucher',
                          textAlign: pw.TextAlign.center,
                          style: pw.TextStyle(fontSize: 9, fontStyle: pw.FontStyle.italic),
                        ),
                      ),
                      if (r.lodgePhone != null)
                        pw.Text(_ascii('Mob. ${r.lodgePhone}'), style: const pw.TextStyle(fontSize: 7)),
                    ],
                  ),
                  pw.SizedBox(height: 2),
                  pw.Center(
                    child: pw.Text(_ascii(name), style: pw.TextStyle(fontSize: 14, fontWeight: pw.FontWeight.bold)),
                  ),
                  if (r.lodgeAddress != null)
                    pw.Center(child: pw.Text(_ascii(r.lodgeAddress!), style: const pw.TextStyle(fontSize: 7))),
                ],
              ),
              // Same corner spot BillPdf uses, opposite the "Mob." line.
              if (logo != null)
                pw.Positioned(
                  left: 0,
                  top: 0,
                  child: pw.Container(
                    height: 22,
                    width: 22,
                    alignment: pw.Alignment.center,
                    child: pw.Image(pw.MemoryImage(logo), fit: pw.BoxFit.contain),
                  ),
                ),
            ],
          ),

          _rule(),
          _strip([_label('No.-'), _filled('${r.receiptNumber ?? r.id}', width: 60), _label('Date -'), _filled(_date(r.createdAt), width: 80)]),
          _rule(),

          _strip([_label('Received with thanks from'), _filled(r.guestName ?? '', flex: 2), _label('Mob. No.'), _filled(r.guestPhone ?? '', width: 76)]),
          pw.SizedBox(height: 2),
          pw.Text(
            _ascii(
              isEvent
                  ? '${r.venueName ?? 'Function'}${r.eventTitle != null ? ' ${r.eventTitle}' : ''}${r.createdAt != null ? ' dt. ${_date(r.createdAt)}' : ''}'
                  : 'Room ${r.roomNumber ?? ''}${r.checkInDate != null ? ' from ${_date(r.checkInDate)}' : ''}',
            ),
            style: pw.TextStyle(fontSize: 8, fontWeight: pw.FontWeight.bold),
          ),
          pw.SizedBox(height: 3),

          _strip([_label('the sum of Rupees'), _filled(_inWords(r.amountReceived), flex: 3)]),
          pw.SizedBox(height: 3),

          pw.Row(
            children: [
              _label('by'),
              pw.SizedBox(width: 4),
              for (final m in const ['CASH', 'UPI', 'CARD'])
                pw.Padding(
                  padding: const pw.EdgeInsets.only(right: 8),
                  child: pw.Row(
                    children: [
                      pw.Container(
                        width: 7,
                        height: 7,
                        alignment: pw.Alignment.center,
                        decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.6)),
                        child: singleMethod == m ? pw.Text('X', style: pw.TextStyle(fontSize: 6, fontWeight: pw.FontWeight.bold)) : null,
                      ),
                      pw.SizedBox(width: 2),
                      pw.Text(_ascii(kPayLabels[m] ?? m), style: const pw.TextStyle(fontSize: 7)),
                    ],
                  ),
                ),
              _label('Txn No.'),
              _filled(singleRef ?? '', flex: 1),
            ],
          ),
          if (tenders.length > 1)
            pw.Padding(
              padding: const pw.EdgeInsets.only(top: 2),
              child: pw.Text(
                _ascii(
                  tenders
                      .map((t) => '${kPayLabels[t.method] ?? t.method}${t.reference != null ? ' (${t.reference})' : ''}: ${_amt(t.amount)}')
                      .join(', '),
                ),
                style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700),
              ),
            ),
          pw.SizedBox(height: 2),
          _strip([_label('against full/part payment of our Bill No.'), _filled('', flex: 1), _label('Dated'), _filled('', width: 50)]),

          if (isGst)
            _strip([
              _label('Place of Supply'),
              _filled(r.lodgeState ?? '', width: 70, fine: true),
              _label('Reverse Charge'),
              _filled('No', width: 26, fine: true),
            ]),
          _rule(),

          // ── The money column ───────────────────────────────────────────
          pw.Table(
            columnWidths: const {0: pw.FlexColumnWidth(), 1: pw.FixedColumnWidth(48), 2: pw.FixedColumnWidth(22)},
            children: [
              _moneyRow(isEvent ? 'Stay Total' : 'Stay Total', r.stayTotal),
              _moneyRow('Less: Advance Received', r.amountReceived),
              _moneyRow('BALANCE DUE', r.balanceDue, strong: true, rule: true),
            ],
          ),

          pw.SizedBox(height: 6),
          pw.Align(
            alignment: pw.Alignment.centerLeft,
            child: pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.6)),
              child: pw.Text(_ascii('₹ ${_amtWhole(r.amountReceived)}/-'), style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold)),
            ),
          ),

          pw.SizedBox(height: 4),
          pw.Text(
            _ascii(
              r.balanceDue <= 0.005
                  ? (isEvent ? 'This advance settles the function total in full.' : 'This advance settles the stay total in full.')
                  : (isEvent
                        ? 'This advance is adjusted against the final bill for the function named above. Please keep this receipt for settlement.'
                        : 'This advance is adjusted against the final bill for the stay named above. Please keep this receipt for settlement.'),
            ),
            style: const pw.TextStyle(fontSize: 6, color: PdfColors.grey700),
          ),
          pw.Text('This is a receipt voucher for an advance, not a tax invoice.', style: const pw.TextStyle(fontSize: 6, color: PdfColors.grey700)),
          if (r.lodgeCity != null)
            pw.Text(_ascii('Subject to ${r.lodgeCity} Jurisdiction.'), style: const pw.TextStyle(fontSize: 6, color: PdfColors.grey700)),

          if (r.isVoid) ...[
            pw.SizedBox(height: 4),
            pw.Center(
              child: pw.Text(
                _ascii('VOID${r.voidReason != null ? ' - ${r.voidReason}' : ''}'),
                style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: PdfColors.red),
              ),
            ),
          ],

          pw.SizedBox(height: 12),
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.end,
            children: [
              _sign("Guest's Sign."),
              pw.Expanded(
                child: pw.Center(child: pw.Text('THANK YOU!', style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold))),
              ),
              _sign('For Prop. / Manager'),
            ],
          ),
        ],
      ),
    );
  }

  // ── Ruled-pad pieces, the same shapes BillPdf draws ────────────────────

  static pw.Widget _rule() => pw.Container(height: 0.5, margin: const pw.EdgeInsets.symmetric(vertical: 3), color: PdfColors.black);

  static pw.Widget _strip(List<pw.Widget> children) =>
      pw.Padding(padding: const pw.EdgeInsets.symmetric(vertical: 1.5), child: pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.end, children: children));

  static pw.Widget _label(String text) => pw.Text(_ascii(text), style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700));

  static pw.Widget _filled(String value, {double? width, int? flex, bool fine = false}) {
    final field = _underline(value, fine: fine);
    if (flex != null) return pw.Expanded(flex: flex, child: field);
    return pw.SizedBox(width: width, child: field);
  }

  static pw.Widget _underline(String value, {bool fine = false}) => pw.Container(
    margin: const pw.EdgeInsets.symmetric(horizontal: 3),
    padding: const pw.EdgeInsets.only(bottom: 1),
    decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(width: 0.4))),
    child: pw.Text(_ascii(value), style: pw.TextStyle(fontSize: fine ? 6.5 : 8, fontWeight: pw.FontWeight.bold)),
  );

  static pw.TableRow _moneyRow(String label, num value, {bool strong = false, bool rule = false}) {
    final (rs, ps) = _split(value);
    return pw.TableRow(
      decoration: rule ? const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(width: 0.5))) : null,
      children: [
        pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 2),
          child: pw.Text(_ascii(label), textAlign: pw.TextAlign.right, style: pw.TextStyle(fontSize: strong ? 9 : 8, fontWeight: strong ? pw.FontWeight.bold : pw.FontWeight.normal)),
        ),
        pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 2),
          child: pw.Text(rs, textAlign: pw.TextAlign.right, style: pw.TextStyle(fontSize: strong ? 9 : 8, fontWeight: strong ? pw.FontWeight.bold : pw.FontWeight.normal)),
        ),
        pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 2),
          child: pw.Text(ps, textAlign: pw.TextAlign.right, style: pw.TextStyle(fontSize: strong ? 9 : 8, fontWeight: strong ? pw.FontWeight.bold : pw.FontWeight.normal)),
        ),
      ],
    );
  }

  static pw.Widget _sign(String caption) => pw.SizedBox(
    width: 90,
    child: pw.Column(
      children: [
        pw.Container(height: 0.5, color: PdfColors.black),
        pw.SizedBox(height: 1),
        pw.Text(_ascii(caption), style: const pw.TextStyle(fontSize: 6)),
      ],
    ),
  );

  /// Money as its rupees and its paise, one to a cell — the printed pad's
  /// own two-column shape.
  static (String, String) _split(num value) {
    final sign = value < 0 ? '-' : '';
    final paiseTotal = (value.abs() * 100).round();
    final whole = paiseTotal ~/ 100;
    final paise = paiseTotal % 100;
    return ('$sign${NumberFormat.decimalPattern('en_IN').format(whole)}', paise.toString().padLeft(2, '0'));
  }

  static String _amt(num n) => NumberFormat('#,##,##0.00', 'en_IN').format(n);

  static String _amtWhole(num n) => NumberFormat.decimalPattern('en_IN').format(n.round());

  static String _date(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final d = DateTime.tryParse(iso);
    return d == null ? iso : DateFormat('dd/MM/yyyy').format(d.toLocal());
  }

  static String _inWords(num amount) {
    final rupees = amount.round();
    return rupees == 0 ? 'Zero Only' : '${_words(rupees)} Only';
  }

  static const _ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ];
  static const _tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  static String _words(int n) {
    if (n < 0) return 'Minus ${_words(-n)}';
    if (n < 20) return _ones[n];
    if (n < 100) return '${_tens[n ~/ 10]}${n % 10 == 0 ? '' : ' ${_ones[n % 10]}'}';
    if (n < 1000) return '${_ones[n ~/ 100]} Hundred${n % 100 == 0 ? '' : ' ${_words(n % 100)}'}';
    if (n < 100000) return '${_words(n ~/ 1000)} Thousand${n % 1000 == 0 ? '' : ' ${_words(n % 1000)}'}';
    if (n < 10000000) return '${_words(n ~/ 100000)} Lakh${n % 100000 == 0 ? '' : ' ${_words(n % 100000)}'}';
    return '${_words(n ~/ 10000000)} Crore${n % 10000000 == 0 ? '' : ' ${_words(n % 10000000)}'}';
  }
}
