import 'dart:typed_data';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/booking.dart' show PaymentLine;
import '../../domain/models/invoice.dart';

/// The bill, as the property's own memo.
///
/// This is the document BillDocument.jsx prints, drawn natively: the masthead
/// over the address and GSTIN, the No./Date rule, the name and mobile rule, the
/// room and persons rule, the stay stated on ruled lines to the left with the
/// gross against the top of it, then the money column proper with its Rs. and
/// Ps. cells running the whole way down.
///
/// Drawn rather than screenshotted. The web has no choice — it rasterises the
/// rendered bill with html2canvas and wraps the image in jsPDF — but that
/// produces a picture: the text cannot be selected or searched, and the file is
/// far larger than it needs to be.
///
/// Every figure is the invoice's own. Nothing is recomputed here; a document
/// that disagreed with the bill it was issued from is worse than none.
class BillPdf {
  // ── The document's own words ──────────────────────────────────────────────
  //
  // Mirrors STRINGS_EN. The Marathi variant overrides only the masthead on the
  // web, so English is what both languages print below it.
  static const _rs = 'Rs.';
  static const _ps = 'Ps.';

  /// Hand the finished file to the platform: the share sheet on a phone, where
  /// "Save to Files", WhatsApp and Print all live.
  static Future<bool> share(Invoice invoice, {String? lodgeName}) async {
    final bytes = await build(invoice, lodgeName: lodgeName);
    final safe = (invoice.invoiceNumber ?? '${invoice.id}').replaceAll(
      RegExp(r'[\\/]'),
      '-',
    );
    return Printing.sharePdf(bytes: bytes, filename: '$safe.pdf');
  }

  static Future<Uint8List> build(
    Invoice invoice, {
    String? lodgeName,

    /// Off only in tests, where the page's own text has to be read back —
    /// a layout that silently dropped a rule still produces a valid PDF of
    /// about the right size, and only the words catch that.
    bool compress = true,
  }) async {
    final doc = pw.Document(compress: compress);

    doc.addPage(
      pw.Page(
        // A5 rather than A6. The memo carries a masthead, four ruled strips, a
        // stay block, up to nine money rows and a footer with two signatures —
        // at A6 the rules collide. A5 is the size the printed pad actually is.
        pageFormat: PdfPageFormat.a5.copyWith(
          marginTop: 18,
          marginBottom: 18,
          marginLeft: 18,
          marginRight: 18,
        ),
        build: (context) => _memo(invoice, lodgeName),
      ),
    );

    return doc.save();
  }

  /// Fold the few non-Latin-1 characters the app's own strings carry down to
  /// what the built-in Helvetica can actually draw.
  ///
  /// The PDF fonts are the standard 14, which have no Unicode support: a "₹"
  /// or an em-dash reaching the page is not an error, it is a *blank*. An
  /// extras line reading "AC/Heater  200" on a bill handed to a guest is worse
  /// than one reading "AC/Heater Rs.200", and the web memo writes "Rs." in its
  /// own column headers anyway. Bundling a Unicode TTF would be a ~200 KB
  /// asset for three characters.
  @visibleForTesting
  static String ascii(String s) => s
      .replaceAll('₹', 'Rs.') // ₹
      .replaceAll(RegExp('[–—]'), '-') // – —
      .replaceAll('·', '.') // ·
      .replaceAll(RegExp('[‘’]'), "'")
      .replaceAll(RegExp('[“”]'), '"');

  // ── The memo ──────────────────────────────────────────────────────────────

  static pw.Widget _memo(Invoice inv, String? fallbackName) {
    final isGst = inv.billingSide == 'GST';
    final name = inv.lodgeName ?? fallbackName ?? '';
    final tenders = inv.tenders;
    final netPayment = inv.totalAmount - inv.advancePaid;

    return pw.Container(
      decoration: pw.BoxDecoration(border: pw.Border.all(width: 0.8)),
      padding: const pw.EdgeInsets.all(6),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          // ── Masthead ────────────────────────────────────────────────────
          pw.Center(
            child: pw.Text(
              ascii(kDocumentLabels[inv.documentType]?.toUpperCase() ?? 'BILL'),
              style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold),
            ),
          ),
          pw.SizedBox(height: 2),
          pw.Center(
            child: pw.Text(
              ascii(name),
              style: pw.TextStyle(fontSize: 15, fontWeight: pw.FontWeight.bold),
            ),
          ),
          if (inv.lodgeAddress != null)
            pw.Center(
              child: pw.Text(
                ascii(inv.lodgeAddress!),
                style: pw.TextStyle(
                  fontSize: 8,
                  fontWeight: pw.FontWeight.bold,
                ),
              ),
            ),
          if (inv.lodgePhone != null)
            pw.Center(
              child: pw.Text(
                ascii('Mob. ${inv.lodgePhone}'),
                style: const pw.TextStyle(fontSize: 8),
              ),
            ),
          // Required on a tax invoice, and constant for this business — but a
          // bill that omits it is defective whether or not it was in doubt.
          if (isGst && inv.gstin != null)
            pw.Center(
              child: pw.Text(
                ascii('GSTIN No. ${inv.gstin}'),
                style: pw.TextStyle(
                  fontSize: 8,
                  fontWeight: pw.FontWeight.bold,
                ),
              ),
            ),

          _rule(),
          // ── No. / Date ──────────────────────────────────────────────────
          _strip([
            _label('No.-'),
            _filled(inv.invoiceNumber ?? '${inv.id}', width: 60),
            _label('Date -'),
            _filled(_date(inv.createdAt), width: 90),
          ]),
          _rule(),
          _strip([
            _label('Name'),
            _filled(inv.guestName ?? '', flex: 3),
            _label('Mob. No.'),
            _filled(inv.guestPhone ?? '', width: 80),
          ]),
          _rule(),
          _strip([
            _label('Room No.'),
            _filled(
              inv.roomNumber == null
                  ? ''
                  : '${inv.roomNumber}'
                        '${inv.categoryName != null ? ' (${inv.categoryName})' : ''}',
              flex: 3,
            ),
            _label('Persons -'),
            _filled('${inv.numGuests ?? ''}', width: 40),
          ]),
          _rule(),

          // ── The body: the stay to the left, the money column to the right ─
          pw.Table(
            border: pw.TableBorder.symmetric(
              inside: const pw.BorderSide(width: 0.5),
            ),
            columnWidths: const {
              0: pw.FlexColumnWidth(),
              1: pw.FixedColumnWidth(52),
              2: pw.FixedColumnWidth(26),
            },
            children: [
              pw.TableRow(
                children: [
                  pw.SizedBox(),
                  _cell(_rs, bold: true, align: pw.TextAlign.right),
                  _cell(_ps, bold: true, align: pw.TextAlign.right),
                ],
              ),
              pw.TableRow(
                children: [
                  _stayBlock(inv, isGst),
                  // The gross the stay came to, against the top of the stay
                  // block — where the memo writes it.
                  _rsCell(inv.gross, lead: true),
                  _psCell(inv.gross, lead: true),
                ],
              ),
            ],
          ),

          // ── The money column proper ──────────────────────────────────────
          //
          // TOTAL AMOUNT is the taxable value, not the gross: the tax sits
          // inside every price here, so it is taken out before the two GST
          // lines state it and added back by GRAND TOTAL.
          pw.Table(
            columnWidths: const {
              0: pw.FlexColumnWidth(),
              1: pw.FixedColumnWidth(52),
              2: pw.FixedColumnWidth(26),
            },
            children: [
              if (inv.discountAmount > 0)
                _moneyRow(
                  'Less: Discount'
                  '${inv.discountPercent > 0 ? ' (${inv.discountPercent}%)' : ''}',
                  -inv.discountAmount,
                ),
              _moneyRow(
                'TOTAL AMOUNT',
                _round2(inv.roomTaxable + inv.foodTaxable),
                rule: true,
              ),
              if (inv.cgstAmount > 0)
                _moneyRow('CGST ${inv.cgstRatePercent} %', inv.cgstAmount),
              if (inv.sgstAmount > 0)
                _moneyRow('SGST ${inv.sgstRatePercent} %', inv.sgstAmount),
              if (inv.foodCgstAmount > 0)
                _moneyRow(
                  'CGST ${inv.foodCgstRatePercent} % (Misc)',
                  inv.foodCgstAmount,
                ),
              if (inv.foodSgstAmount > 0)
                _moneyRow(
                  'SGST ${inv.foodSgstRatePercent} % (Misc)',
                  inv.foodSgstAmount,
                ),
              if (inv.roundOff != 0) _moneyRow('Round off', inv.roundOff),
              _moneyRow('GRAND TOTAL', inv.totalAmount, strong: true),
              if (inv.advancePaid > 0)
                _moneyRow(
                  inv.advanceReceiptNumbers == null
                      ? 'Less Advance if any'
                      : 'Less Advance if any (Rec. No. ${inv.advanceReceiptNumbers})',
                  inv.advancePaid,
                ),
              _moneyRow(
                'Net Payment',
                netPayment,
                strong: true,
                // With one tender the method is said beneath the label, the
                // way the web decorates it. With a split it is dropped here
                // and each method gets its own row below, or the first would
                // be named twice.
                sub: tenders.length == 1 ? _tenderLine(tenders.single) : null,
              ),
              if (tenders.length > 1)
                for (final t in tenders)
                  _moneyRow(
                    kPayLabels[t.method] ?? t.method,
                    t.amount,
                    sub: t.reference == null ? null : 'Txn No. ${t.reference}',
                  ),
            ],
          ),

          _rule(),
          // ── In words ────────────────────────────────────────────────────
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.end,
            children: [
              _label('(Inwords Rupees'),
              pw.Expanded(
                child: pw.Container(
                  margin: const pw.EdgeInsets.symmetric(horizontal: 3),
                  decoration: const pw.BoxDecoration(
                    border: pw.Border(bottom: pw.BorderSide(width: 0.4)),
                  ),
                  child: pw.Text(
                    ascii(_inWords(inv.totalAmount)),
                    style: pw.TextStyle(
                      fontSize: 8,
                      fontWeight: pw.FontWeight.bold,
                    ),
                  ),
                ),
              ),
              _label(')'),
            ],
          ),

          _rule(),
          // ── Footer ──────────────────────────────────────────────────────
          pw.Text(
            ascii('Subject to ${inv.lodgeCity ?? 'local'} Jurisdiction.'),
            style: const pw.TextStyle(fontSize: 6),
          ),
          pw.Text(
            ascii(
              'Declaration : I/We declare that this invoice shows that actual '
              'price of the services described and that all particulars are true '
              'and correct.',
            ),
            style: const pw.TextStyle(fontSize: 6),
          ),
          pw.Text(
            ascii(
              inv.checkinMode == 'NIGHT_BASED' && inv.checkOutTime != null
                  ? 'Checkout by ${inv.checkOutTime} on the departure date.'
                  : 'Checkout time 24 hours from check-in.',
            ),
            style: const pw.TextStyle(fontSize: 6),
          ),

          if (inv.isVoid) ...[
            pw.SizedBox(height: 4),
            pw.Center(
              child: pw.Text(
                ascii(
                  'VOID${inv.voidReason == null ? '' : ' — ${inv.voidReason}'}',
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
                    ascii('THANK YOU!'),
                    style: pw.TextStyle(
                      fontSize: 11,
                      fontWeight: pw.FontWeight.bold,
                    ),
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

  // ── The stay, on ruled lines ──────────────────────────────────────────────

  static pw.Widget _stayBlock(Invoice inv, bool isGst) {
    final from = _splitDateTime(inv.actualCheckInAt ?? inv.checkInDate);
    final to = _splitDateTime(inv.actualCheckOutAt ?? inv.checkOutDate);

    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 3, horizontal: 2),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          _strip([
            _label('For'),
            _filled('${inv.nights}', width: 30),
            _label('Days'),
          ]),
          _strip([
            _label('From'),
            _filled(from.$1, width: 76),
            _label('at'),
            _filled(from.$2, width: 60),
          ]),
          _strip([
            _label('To'),
            _filled(to.$1, width: 76),
            _label('at'),
            _filled(to.$2, width: 60),
          ]),
          _strip([
            _label(_rs),
            _filled(inv.perDay == null ? '' : _amt(inv.perDay!), width: 66),
            _label('Per day'),
          ]),
          // What the day count doesn't cover — an extra bed, AC, an overstay.
          // Named rather than folded into the total, each against what it came
          // to. The rule prints whether or not anything was added: a blank rule
          // is part of the shape.
          _strip([
            _label('Extra Charges'),
            pw.Expanded(
              child: inv.extras.isEmpty
                  ? _underline('')
                  : pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.stretch,
                      children: [
                        for (final e in inv.extras)
                          pw.Row(
                            children: [
                              pw.Expanded(
                                child: pw.Text(
                                  ascii(e.label),
                                  style: pw.TextStyle(
                                    fontSize: 7,
                                    fontWeight: pw.FontWeight.bold,
                                  ),
                                ),
                              ),
                              pw.Text(
                                ascii(_amt(e.amount)),
                                style: pw.TextStyle(
                                  fontSize: 7,
                                  fontWeight: pw.FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                      ],
                    ),
            ),
          ]),
          if (isGst) ...[
            _strip([
              _label('Place of Supply'),
              _filled(inv.lodgeCity ?? '', width: 70, fine: true),
              _label('Reverse Charge'),
              _filled('No', width: 26, fine: true),
            ]),
            if (inv.roomSubtotal > 0)
              _strip([_label('SAC'), _filled('996311', width: 60, fine: true)]),
          ],
        ],
      ),
    );
  }

  // ── Pieces ────────────────────────────────────────────────────────────────

  static pw.Widget _rule() => pw.Container(
    height: 0.5,
    margin: const pw.EdgeInsets.symmetric(vertical: 2),
    color: PdfColors.black,
  );

  static pw.Widget _strip(List<pw.Widget> children) => pw.Padding(
    padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
    child: pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.end,
      children: children,
    ),
  );

  static pw.Widget _label(String text) => pw.Text(
    ascii(text),
    style: const pw.TextStyle(fontSize: 7, color: PdfColors.grey700),
  );

  /// A value written onto a ruled line, the way it is on the pad.
  static pw.Widget _filled(
    String value, {
    double? width,
    int? flex,
    bool fine = false,
  }) {
    final field = _underline(value, fine: fine);
    if (flex != null) return pw.Expanded(flex: flex, child: field);
    return pw.SizedBox(width: width, child: field);
  }

  static pw.Widget _underline(String value, {bool fine = false}) =>
      pw.Container(
        margin: const pw.EdgeInsets.symmetric(horizontal: 3),
        padding: const pw.EdgeInsets.only(bottom: 1),
        decoration: const pw.BoxDecoration(
          border: pw.Border(bottom: pw.BorderSide(width: 0.4)),
        ),
        child: pw.Text(
          ascii(value),
          style: pw.TextStyle(
            fontSize: fine ? 6.5 : 8,
            fontWeight: pw.FontWeight.bold,
          ),
        ),
      );

  static pw.Widget _cell(
    String text, {
    bool bold = false,
    pw.TextAlign align = pw.TextAlign.left,
  }) => pw.Padding(
    padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 2),
    child: pw.Text(
      ascii(text),
      textAlign: align,
      style: pw.TextStyle(
        fontSize: 7,
        fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal,
      ),
    ),
  );

  /// Money is split into its rupees and its paise, one to a cell — that column
  /// pair is the shape of the printed pad, and the whole document hangs off it.
  ///
  /// Rounded before it is split. Flooring a raw 95.999 would print 95 beside a
  /// 100-paise cell, which is a rupee lost off a bill that has to add up in
  /// front of the guest paying it.
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

  static pw.Widget _rsCell(
    num value, {
    bool lead = false,
    bool strong = false,
  }) => pw.Padding(
    padding: pw.EdgeInsets.only(
      left: 3,
      right: 3,
      top: lead ? 3 : 1.5,
      bottom: 1.5,
    ),
    child: pw.Text(
      ascii(_split(value).$1),
      textAlign: pw.TextAlign.right,
      style: pw.TextStyle(
        fontSize: strong ? 10 : 8,
        fontWeight: strong || lead ? pw.FontWeight.bold : pw.FontWeight.normal,
      ),
    ),
  );

  static pw.Widget _psCell(
    num value, {
    bool lead = false,
    bool strong = false,
  }) => pw.Padding(
    padding: pw.EdgeInsets.only(
      left: 3,
      right: 3,
      top: lead ? 3 : 1.5,
      bottom: 1.5,
    ),
    child: pw.Text(
      ascii(_split(value).$2),
      textAlign: pw.TextAlign.right,
      style: pw.TextStyle(
        fontSize: strong ? 10 : 8,
        fontWeight: strong || lead ? pw.FontWeight.bold : pw.FontWeight.normal,
      ),
    ),
  );

  static pw.TableRow _moneyRow(
    String label,
    num value, {
    bool strong = false,
    bool rule = false,
    String? sub,
  }) => pw.TableRow(
    decoration: rule
        ? const pw.BoxDecoration(
            border: pw.Border(top: pw.BorderSide(width: 0.5)),
          )
        : null,
    children: [
      pw.Padding(
        padding: const pw.EdgeInsets.symmetric(horizontal: 3, vertical: 1.5),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.end,
          children: [
            pw.Text(
              ascii(label),
              textAlign: pw.TextAlign.right,
              style: pw.TextStyle(
                fontSize: strong ? 10 : 8,
                fontWeight: strong ? pw.FontWeight.bold : pw.FontWeight.normal,
              ),
            ),
            if (sub != null)
              pw.Text(
                ascii(sub),
                style: const pw.TextStyle(
                  fontSize: 6,
                  color: PdfColors.grey700,
                ),
              ),
          ],
        ),
      ),
      _rsCell(value, strong: strong),
      _psCell(value, strong: strong),
    ],
  );

  static String? _tenderLine(PaymentLine t) {
    final method = kPayLabels[t.method] ?? t.method;
    return t.reference == null ? method : '$method  Txn No. ${t.reference}';
  }

  static pw.Widget _sign(String caption) => pw.SizedBox(
    width: 88,
    child: pw.Column(
      children: [
        pw.Container(height: 0.5, color: PdfColors.black),
        pw.SizedBox(height: 1),
        pw.Text(ascii(caption), style: const pw.TextStyle(fontSize: 6)),
      ],
    ),
  );

  // ── Formatting ────────────────────────────────────────────────────────────

  /// The two rules a bill is wrong without, exposed so they can be tested
  /// without rendering a page: the rupee/paise split, and the words.
  @visibleForTesting
  static (String, String) debugSplit(num value) => _split(value);

  @visibleForTesting
  static String debugWords(num amount) => _inWords(amount);

  static num _round2(num n) => (n * 100).round() / 100;

  static String _amt(num n) => NumberFormat('#,##,##0.00', 'en_IN').format(n);

  static String _date(String? iso) {
    if (iso == null || iso.isEmpty) return '';
    final d = DateTime.tryParse(iso);
    return d == null ? iso : DateFormat('dd/MM/yyyy').format(d.toLocal());
  }

  /// The date and the time as two fields, because the memo rules them apart:
  /// "From ____ at ____".
  static (String, String) _splitDateTime(String? iso) {
    if (iso == null || iso.isEmpty) return ('', '');
    final d = DateTime.tryParse(iso);
    if (d == null) return (iso, '');
    final local = d.toLocal();
    // A plain date carries no useful time — a stay recorded as 2026-08-26 did
    // not begin at midnight, and printing "12:00 am" would say it did.
    final hasTime = iso.contains('T');
    return (
      DateFormat('dd/MM/yyyy').format(local),
      hasTime ? DateFormat('hh:mm a').format(local) : '',
    );
  }

  /// The amount in words, as the memo's "(Inwords Rupees ____ )" rule wants.
  static String _inWords(num amount) {
    final rupees = amount.round();
    if (rupees == 0) return 'Zero Only';
    return '${_words(rupees)} Only';
  }

  static const _ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  static const _tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ];

  /// Indian grouping — lakh and crore, not million. A bill that read
  /// "One Million" at an Indian front desk would be read twice and trusted
  /// once.
  static String _words(int n) {
    if (n < 0) return 'Minus ${_words(-n)}';
    if (n < 20) return _ones[n];
    if (n < 100) {
      return '${_tens[n ~/ 10]}${n % 10 == 0 ? '' : ' ${_ones[n % 10]}'}';
    }
    if (n < 1000) {
      return '${_ones[n ~/ 100]} Hundred'
          '${n % 100 == 0 ? '' : ' ${_words(n % 100)}'}';
    }
    if (n < 100000) {
      return '${_words(n ~/ 1000)} Thousand'
          '${n % 1000 == 0 ? '' : ' ${_words(n % 1000)}'}';
    }
    if (n < 10000000) {
      return '${_words(n ~/ 100000)} Lakh'
          '${n % 100000 == 0 ? '' : ' ${_words(n % 100000)}'}';
    }
    return '${_words(n ~/ 10000000)} Crore'
        '${n % 10000000 == 0 ? '' : ' ${_words(n % 10000000)}'}';
  }
}

/// The methods, as the document names them.
const kPayLabels = <String, String>{
  'CASH': 'Cash',
  'UPI': 'UPI',
  'CARD': 'Card',
};
