import 'dart:typed_data';

import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/invoice.dart';
import 'receipt_download.dart';
import 'receipt_share.dart';

/// The stock this receipt can print onto — the same table the web app's own
/// paper picker offers (billPaper.js), so a desk that has learned the sizes
/// there finds the same names and dimensions here.
class ReceiptPaperSize {
  final String id;
  final String label;
  final String hint;
  final PdfPageFormat format;

  /// The sheet margin, in points — 5mm/8mm/12mm converted, matching the web
  /// table's own margins for the same stock.
  final double margin;

  const ReceiptPaperSize(this.id, this.label, this.hint, this.format, this.margin);

  /// A6 — the slip size a desk actually prints on, same default as the web
  /// app: a bill or receipt on A4 comes out a quarter-filled sheet that gets
  /// folded, so the smallest legible stock is what both apps reach for first.
  static const defaultId = 'a6';

  static const List<ReceiptPaperSize> all = [
    ReceiptPaperSize('a4', 'A4', '210 × 297 mm', PdfPageFormat.a4, 34),
    ReceiptPaperSize('a5', 'A5', '148 × 210 mm', PdfPageFormat.a5, 23),
    ReceiptPaperSize('a6', 'A6', '105 × 148 mm', PdfPageFormat.a6, 14),
    ReceiptPaperSize('letter', 'Letter', '8.5 × 11 in', PdfPageFormat.letter, 34),
    ReceiptPaperSize(
      'half-letter',
      'Half Letter',
      '8.5 × 5.5 in',
      PdfPageFormat(612, 396),
      23,
    ),
  ];

  static ReceiptPaperSize byId(String id) {
    for (final p in all) {
      if (p.id == id) return p;
    }
    return byId(defaultId);
  }
}

/// The slip handed to a guest who pays an advance — deliberately the same
/// printed form [BillPdf] draws (same masthead, same ruled register strip,
/// same Rs./Ps. money column), because it comes off the same pad and the
/// same printer. What differs is what a receipt is *for*: a bill states what
/// was sold and what is owed, this states what was received and what is
/// left, so the body carries no charge lines and the money column ends at
/// "Balance Due" instead of "Net Payment".
class AdvanceReceiptPdf {
  static const _docLabel = {
    'RECEIPT_VOUCHER': 'Receipt Voucher',
    'ADVANCE_RECEIPT': 'Advance Receipt',
  };

  static const _payLabel = {'CASH': 'Cash', 'UPI': 'UPI', 'CARD': 'Card'};

  /// The design width the memo itself is laid out at, in points — the A5
  /// pad's content column, unaffected by which stock this actually prints
  /// to. [build] scales this whole thing onto whatever [ReceiptPaperSize]
  /// was chosen, the same way the web's own paper picker scales one fixed
  /// capture onto whichever sheet the desk selects.
  static const double _designWidth = 419.53 - 36;

  static Future<bool> share(AdvanceReceipt receipt, {String paperId = ReceiptPaperSize.defaultId}) async {
    final bytes = await build(receipt, paperId: paperId);
    final safe = (receipt.receiptNumber ?? '${receipt.id}').replaceAll(
      RegExp(r'[\\/]'),
      '-',
    );
    await shareBytesFromDevice(bytes, '$safe.pdf');
    return true;
  }

  /// Hand the finished file straight to the OS print dialog, distinct from
  /// [share] and [download] — the desk's third way to get the receipt off
  /// the phone.
  static Future<void> print(AdvanceReceipt receipt, {String paperId = ReceiptPaperSize.defaultId}) async {
    final bytes = await build(receipt, paperId: paperId);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  /// Save the file to the device itself — a real download, distinct from
  /// handing it to the printer or to the share sheet (which, on a browser
  /// with no share target of its own, otherwise looks identical to this).
  /// Returns where it landed: a filesystem path off the web, and a plain
  /// description of the browser's own downloads on it.
  static Future<String> download(AdvanceReceipt receipt, {String paperId = ReceiptPaperSize.defaultId}) async {
    final bytes = await build(receipt, paperId: paperId);
    final safe = (receipt.receiptNumber ?? '${receipt.id}').replaceAll(
      RegExp(r'[\\/]'),
      '-',
    );
    return saveBytesToDevice(bytes, '$safe.pdf');
  }

  static Future<Uint8List> build(AdvanceReceipt receipt, {String paperId = ReceiptPaperSize.defaultId}) async {
    final paper = ReceiptPaperSize.byId(paperId);
    final doc = pw.Document();
    doc.addPage(
      pw.Page(
        pageFormat: paper.format.copyWith(
          marginTop: paper.margin,
          marginBottom: paper.margin,
          marginLeft: paper.margin,
          marginRight: paper.margin,
        ),
        build: (context) => pw.FittedBox(
          fit: pw.BoxFit.contain,
          alignment: pw.Alignment.topCenter,
          child: pw.SizedBox(width: _designWidth, child: _memo(receipt)),
        ),
      ),
    );
    return doc.save();
  }

  static String _ascii(String s) => s
      .replaceAll('₹', 'Rs.')
      .replaceAll(RegExp('[–—]'), '-')
      .replaceAll('·', '.')
      .replaceAll(RegExp('[‘’]'), "'")
      .replaceAll(RegExp('[“”]'), '"');

  static pw.Widget _memo(AdvanceReceipt r) {
    final isGst = r.billingSide == 'GST';
    final tenders = r.tenders;
    final split = tenders.length > 1;
    final paidBy = tenders.map((t) => t.method).toSet();
    final nights = _nightsOf(r);
    final stayLine = [
      if (r.roomNumber != null) 'Room No. ${r.roomNumber}',
      if (r.checkInDate != null) 'dt. ${_date(r.checkInDate)}',
      if (nights != null) '($nights ${nights == 1 ? 'Day' : 'Days'})',
      if (r.numGuests != null) 'Persons - ${r.numGuests}',
    ].join('  ');

    return pw.Container(
      decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.8)),
      padding: const pw.EdgeInsets.all(6),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          // The masthead, laid out the same way the website's own
          // `AdvanceReceiptDocument` does: the phone numbers pinned to the
          // top-right corner rather than sitting in the reading flow, the
          // property's name the dominant line, and no GSTIN line here — the
          // GSTIN only ever appears against "Place of Supply" further down,
          // never repeated in the masthead itself.
          pw.Stack(
            children: [
              pw.Column(
                children: [
                  pw.Center(
                    child: pw.Text(
                      _ascii(_docLabel[r.documentType] ?? 'Advance Receipt'),
                      style: pw.TextStyle(
                        fontSize: 9,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                  ),
                  pw.SizedBox(height: 3),
                  pw.Center(
                    child: pw.Text(
                      _ascii((r.lodgeName ?? '').toUpperCase()),
                      style: pw.TextStyle(
                        fontSize: 20,
                        fontWeight: pw.FontWeight.bold,
                        letterSpacing: 0.3,
                      ),
                    ),
                  ),
                ],
              ),
              if (r.lodgePhone != null)
                pw.Positioned(
                  right: 0,
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.end,
                    children: [
                      for (final p in r.lodgePhone!.split(RegExp('[,/]')))
                        if (p.trim().isNotEmpty)
                          pw.Text(
                            _ascii('Mob. ${p.trim()}'),
                            style: const pw.TextStyle(fontSize: 6.5),
                          ),
                    ],
                  ),
                ),
            ],
          ),
          if (r.lodgeAddress != null)
            pw.Container(
              margin: const pw.EdgeInsets.only(top: 3),
              padding: const pw.EdgeInsets.only(top: 2),
              decoration: const pw.BoxDecoration(
                border: pw.Border(top: pw.BorderSide(width: 0.4)),
              ),
              child: pw.Center(
                child: pw.Text(
                  _ascii(
                    [r.lodgeAddress, r.lodgeCity, r.lodgeState]
                        .whereType<String>()
                        .join(', '),
                  ),
                  style: pw.TextStyle(fontSize: 8, fontWeight: pw.FontWeight.bold),
                ),
              ),
            ),

          _rule(),
          _strip([
            _label('No.-'),
            _filled(r.receiptNumber ?? '${r.id}', width: 60),
            _label('Date -'),
            _filled(_date(r.createdAt), width: 90),
          ]),
          _rule(),
          _strip([
            _label('Received with thanks from'),
            _filled(r.guestName ?? '', flex: 3),
            _label('Mob. No.'),
            _filled(r.guestPhone ?? '', width: 80),
          ]),
          _rule(),
          _strip([_filled(stayLine, flex: 1)]),
          _rule(),
          _strip([
            _label('the sum of Rupees'),
            _filled(_ascii(_inWords(r.amountReceived)), flex: 1),
          ]),
          _rule(),
          _strip([
            _label('by'),
            for (final m in _payLabel.entries)
              pw.Padding(
                padding: const pw.EdgeInsets.only(right: 6),
                child: pw.Row(
                  mainAxisSize: pw.MainAxisSize.min,
                  children: [
                    pw.Container(
                      width: 7,
                      height: 7,
                      margin: const pw.EdgeInsets.only(right: 2),
                      decoration: pw.BoxDecoration(
                        border: pw.Border.all(width: 0.6),
                        color: paidBy.contains(m.key)
                            ? PdfColors.black
                            : PdfColors.white,
                      ),
                    ),
                    pw.Text(m.value, style: const pw.TextStyle(fontSize: 7)),
                  ],
                ),
              ),
            if (split)
              pw.Expanded(
                child: _underline(
                  tenders
                      .map((t) => '${_payLabel[t.method] ?? t.method} ${t.amount}')
                      .join(' · '),
                ),
              )
            else ...[
              _label('Txn No.'),
              _filled(r.paymentReference ?? '', width: 70),
            ],
          ]),
          _rule(),
          _strip([
            _label('against full/part payment of our Bill No.'),
            _filled('', width: 60),
            _label('Dated'),
            _filled('', width: 60),
          ]),
          if (isGst) ...[
            _rule(),
            _strip([
              _label('Place of Supply'),
              _filled(_placeOfSupply(r) ?? '', width: 90, fine: true),
              _label('Reverse Charge'),
              _filled('No', width: 26, fine: true),
            ]),
          ],
          _rule(),

          if (r.stayTotal > 0)
            pw.Table(
              columnWidths: const {
                0: pw.FlexColumnWidth(),
                1: pw.FixedColumnWidth(52),
                2: pw.FixedColumnWidth(26),
              },
              children: [
                if (r.roundOff != 0)
                  _moneyRow('Sub Total', _round2(r.stayTotal - r.roundOff)),
                if (r.roundOff != 0) _moneyRow('Round off', r.roundOff),
                _moneyRow('Stay Total', r.stayTotal, rule: true),
                _moneyRow('Less: Advance Received', r.amountReceived),
                _moneyRow('BALANCE DUE', r.balanceDue, strong: true, rule: true),
              ],
            ),

          pw.SizedBox(height: 6),
          pw.Align(
            alignment: pw.Alignment.centerLeft,
            child: pw.Container(
              padding: const pw.EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.8)),
              child: pw.Text(
                _ascii(_amountBoxed(r.amountReceived)),
                style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold),
              ),
            ),
          ),

          pw.SizedBox(height: 6),
          pw.Text(
            _ascii(
              r.paidInFull
                  ? 'This payment settles the stay named above in full. '
                        'Please present this receipt at check-in.'
                  : 'This advance is adjusted against the final bill for the '
                        'stay named above. Please present this receipt at '
                        'check-in.',
            ),
            style: const pw.TextStyle(fontSize: 6),
          ),
          if (isGst)
            pw.Text(
              'This is a receipt voucher for an advance, not a tax invoice.',
              style: const pw.TextStyle(fontSize: 6),
            ),
          pw.Text(
            _ascii('Subject to ${r.lodgeCity ?? 'local'} Jurisdiction.'),
            style: const pw.TextStyle(fontSize: 6),
          ),

          if (r.isVoid) ...[
            pw.SizedBox(height: 4),
            pw.Center(
              child: pw.Text(
                _ascii(
                  'VOID${r.voidReason == null ? '' : ' — ${r.voidReason}'}',
                ),
                style: pw.TextStyle(
                  fontSize: 12,
                  fontWeight: pw.FontWeight.bold,
                  color: PdfColors.red,
                ),
              ),
            ),
          ],

          pw.SizedBox(height: 14),
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.end,
            children: [
              _sign("Guest's Sign."),
              pw.Expanded(
                child: pw.Center(
                  child: pw.Text(
                    'THANK YOU!',
                    style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold),
                  ),
                ),
              ),
              _sign('For Prop. / Manager'),
            ],
          ),
        ],
      ),
    );
  }

  // ── Pieces, the same shapes BillPdf draws with ───────────────────────────

  static pw.Widget _rule() => pw.Container(
    height: 0.5,
    margin: const pw.EdgeInsets.symmetric(vertical: 2),
    color: PdfColors.black,
  );

  static pw.Widget _strip(List<pw.Widget> children) => pw.Padding(
    padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
    child: pw.Row(crossAxisAlignment: pw.CrossAxisAlignment.end, children: children),
  );

  static pw.Widget _label(String text) => pw.Text(
    _ascii(text),
    style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700),
  );

  static pw.Widget _filled(String value, {double? width, int? flex, bool fine = false}) {
    final field = _underline(value, fine: fine);
    if (flex != null) return pw.Expanded(flex: flex, child: field);
    return pw.SizedBox(width: width, child: field);
  }

  static pw.Widget _underline(String value, {bool fine = false}) => pw.Container(
    margin: const pw.EdgeInsets.symmetric(horizontal: 3),
    padding: const pw.EdgeInsets.only(bottom: 1),
    decoration: const pw.BoxDecoration(
      border: pw.Border(bottom: pw.BorderSide(width: 0.4)),
    ),
    child: pw.Text(
      _ascii(value),
      style: pw.TextStyle(fontSize: fine ? 6.5 : 8, fontWeight: pw.FontWeight.bold),
    ),
  );

  static (String, String) _split(num value) {
    final sign = value < 0 ? '-' : '';
    final paiseTotal = (value.abs() * 100).round();
    final whole = paiseTotal ~/ 100;
    final paise = paiseTotal % 100;
    return (
      '$sign${NumberFormat.decimalPattern('en_IN').format(whole)}',
      paise.toString().padLeft(2, '0'),
    );
  }

  static pw.TableRow _moneyRow(
    String label,
    num value, {
    bool strong = false,
    bool rule = false,
  }) {
    final (rs, ps) = _split(value);
    return pw.TableRow(
      decoration: rule
          ? const pw.BoxDecoration(border: pw.Border(top: pw.BorderSide(width: 0.5)))
          : null,
      children: [
        pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 1.5),
          child: pw.Text(
            _ascii(label),
            textAlign: pw.TextAlign.right,
            style: pw.TextStyle(
              fontSize: strong ? 10 : 8,
              fontWeight: strong ? pw.FontWeight.bold : pw.FontWeight.normal,
            ),
          ),
        ),
        pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 1.5),
          child: pw.Text(
            rs,
            textAlign: pw.TextAlign.right,
            style: pw.TextStyle(
              fontSize: strong ? 10 : 8,
              fontWeight: strong ? pw.FontWeight.bold : pw.FontWeight.normal,
            ),
          ),
        ),
        pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 1.5),
          child: pw.Text(
            ps,
            textAlign: pw.TextAlign.right,
            style: pw.TextStyle(
              fontSize: strong ? 10 : 8,
              fontWeight: strong ? pw.FontWeight.bold : pw.FontWeight.normal,
            ),
          ),
        ),
      ],
    );
  }

  static pw.Widget _sign(String caption) => pw.SizedBox(
    width: 88,
    child: pw.Column(
      children: [
        pw.Container(height: 0.5, color: PdfColors.black),
        pw.SizedBox(height: 1),
        pw.Text(_ascii(caption), style: const pw.TextStyle(fontSize: 6)),
      ],
    ),
  );

  static num _round2(num n) => (n * 100).round() / 100;

  static String? _placeOfSupply(AdvanceReceipt r) {
    if (r.lodgeState == null) return null;
    final match = RegExp(r'^\d{2}').firstMatch(r.gstin ?? '');
    return match == null ? r.lodgeState : '${r.lodgeState} (${match.group(0)})';
  }

  static int? _nightsOf(AdvanceReceipt r) {
    final from = DateTime.tryParse(r.checkInDate ?? '');
    final to = DateTime.tryParse(r.checkOutDate ?? '');
    if (from == null || to == null) return null;
    final n = to.difference(from).inDays;
    return n > 0 ? n : 1;
  }

  static String _date(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final d = DateTime.tryParse(iso);
    return d == null ? iso : DateFormat('dd/MM/yyyy').format(d.toLocal());
  }

  static String _amountBoxed(num amount) {
    final whole = amount.truncate();
    final paise = ((amount - whole) * 100).round();
    return '₹${NumberFormat.decimalPattern('en_IN').format(whole)}'
        '${paise == 0 ? '/-' : '.${paise.toString().padLeft(2, '0')}'}';
  }

  static String _inWords(num amount) {
    final rupees = amount.round();
    if (rupees == 0) return 'Zero Only';
    return '${_words(rupees)} Only';
  }

  static const _ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  static const _tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
  ];

  static String _words(int n) {
    if (n < 0) return 'Minus ${_words(-n)}';
    if (n < 20) return _ones[n];
    if (n < 100) {
      return '${_tens[n ~/ 10]}${n % 10 == 0 ? '' : ' ${_ones[n % 10]}'}';
    }
    if (n < 1000) {
      return '${_ones[n ~/ 100]} Hundred${n % 100 == 0 ? '' : ' ${_words(n % 100)}'}';
    }
    if (n < 100000) {
      return '${_words(n ~/ 1000)} Thousand${n % 1000 == 0 ? '' : ' ${_words(n % 1000)}'}';
    }
    if (n < 10000000) {
      return '${_words(n ~/ 100000)} Lakh${n % 100000 == 0 ? '' : ' ${_words(n % 100000)}'}';
    }
    return '${_words(n ~/ 10000000)} Crore${n % 10000000 == 0 ? '' : ' ${_words(n % 10000000)}'}';
  }
}
