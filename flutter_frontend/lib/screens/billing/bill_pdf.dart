import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../core/constant.dart';
import '../../domain/models/booking.dart' show PaymentLine;
import '../../domain/models/invoice.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';

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

  // The printed memo's own ruling, same three colours BillDocument.css draws
  // it in: a dark slate for every rule that actually divides the form into
  // its boxes, a lighter hairline for the one rule inside the money column
  // itself (Rs. from Ps.), and a pale tint behind the column headings.
  static const _lineColor = PdfColor.fromInt(0xFF2C3742); // --bill-line
  static const _hairColor = PdfColor.fromInt(0xFFB8C1C9); // --bill-hair
  static const _tintColor = PdfColor.fromInt(0xFFF4F6F8); // --bill-tint
  static const _roomRuleColor = PdfColor.fromInt(0xFFC3CCD3); // .memo__room
  static const _dotColor = PdfColor.fromInt(0xFF8D99A4); // .bill-doc__filled

  /// Hand the finished file to the real OS share sheet — see
  /// `receipt_share.dart` for why this is not simply `Printing.sharePdf`:
  /// on the web that never attempts the browser's own share API at all and
  /// just downloads the file, which made this look identical to [download].
  static Future<void> share(Invoice invoice, {String? lodgeName}) async {
    final bytes = await build(invoice, lodgeName: lodgeName);
    final safe = (invoice.invoiceNumber ?? '${invoice.id}').replaceAll(
      RegExp(r'[\\/]'),
      '-',
    );
    await shareBytesFromDevice(bytes, '$safe.pdf');
  }

  /// Hand the finished file straight to the OS print dialog, rather than a
  /// share sheet or a download — the desk's third option alongside [share]
  /// and [download].
  static Future<void> print(Invoice invoice, {String? lodgeName}) async {
    final bytes = await build(invoice, lodgeName: lodgeName);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  /// Save the file to the device itself — a real download, distinct from
  /// [share]. Returns where it landed.
  static Future<String> download(Invoice invoice, {String? lodgeName}) async {
    final bytes = await build(invoice, lodgeName: lodgeName);
    final safe = (invoice.invoiceNumber ?? '${invoice.id}').replaceAll(
      RegExp(r'[\\/]'),
      '-',
    );
    return saveBytesToDevice(bytes, '$safe.pdf');
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
    final logo = await _fetchLogo(invoice.lodgeLogoUrl);

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
        build: (context) => _memo(invoice, lodgeName, logo),
      ),
    );

    return doc.save();
  }

  /// The property's logo, as bytes ready for [pw.MemoryImage] — null when the
  /// property has none, or hasn't turned on printing it (see
  /// [Invoice.lodgeLogoUrl]), or the fetch simply fails. A bill that can't
  /// reach the logo file still has to print; it just prints without one.
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

  static pw.Widget _memo(Invoice inv, String? fallbackName, Uint8List? logo) {
    final isGst = inv.billingSide == 'GST';
    final name = inv.lodgeName ?? fallbackName ?? '';
    final tenders = inv.tenders;
    final netPayment = inv.totalAmount - inv.advancePaid;

    return pw.Container(
      decoration: pw.BoxDecoration(
        border: pw.Border.all(width: 0.8, color: _lineColor),
      ),
      padding: const pw.EdgeInsets.all(6),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          // ── Masthead ────────────────────────────────────────────────────
          //
          // "Cash Memo" (the document kind) sits centred above the house
          // name, with the phone numbers stacked in the top-right corner
          // beside it and the logo in the top-left — the same three-corner
          // layout `.memo__head`/`.memo__phones`/`.memo__logo` draw on the
          // web, rather than the phone printing as its own centred line.
          pw.Stack(
            children: [
              pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.stretch,
                children: [
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
                ],
              ),
              if (logo != null)
                pw.Positioned(
                  left: 0,
                  top: 0,
                  child: pw.Container(
                    height: 26,
                    width: 26,
                    alignment: pw.Alignment.center,
                    child: pw.Image(pw.MemoryImage(logo), fit: pw.BoxFit.contain),
                  ),
                ),
              if (inv.lodgePhone != null)
                pw.Positioned(
                  right: 0,
                  top: 0,
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.end,
                    children: [
                      for (final p in inv.lodgePhone!
                          .split(RegExp('[,/]'))
                          .map((p) => p.trim())
                          .where((p) => p.isNotEmpty))
                        pw.Text(
                          ascii('Mob. $p'),
                          style: pw.TextStyle(
                            fontSize: 7,
                            fontWeight: pw.FontWeight.bold,
                          ),
                        ),
                    ],
                  ),
                ),
            ],
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
          // A function bill doesn't print a bill number at all — the desk
          // asked for it to stay off the sheet, not just moved elsewhere,
          // same as BillDocument.jsx.
          _strip([
            if (!inv.isEventBill) ...[
              _label('No.-'),
              _filled(inv.invoiceNumber ?? '${inv.id}', width: 60),
            ],
            _label('Date -'),
            _filled(_date(inv.createdAt), width: 90),
          ]),
          _rule(),
          _strip([
            _label('Name'),
            // A room tab or a takeaway prints like a stay bill's guest; only a
            // table tab has nobody behind it and falls back to naming the
            // table, same as BillDocument.jsx.
            _filled(
              inv.isFoodBill
                  ? (inv.guestName ?? inv.tableLabel ?? 'Counter')
                  : (inv.guestName ?? ''),
              flex: 3,
            ),
            _label('Mob. No.'),
            _filled(inv.guestPhone ?? '', width: 80),
          ]),
          _rule(),
          // A function bill names the venue and the plate count here instead
          // of a room; a food bill has no room or stay behind it, so it
          // names the bill number and the table/covers instead of leaving
          // two rules blank.
          if (inv.isEventBill)
            _strip([
              _label('Venue'),
              _filled(inv.venueName ?? '', flex: 2),
              _label('Plates -'),
              _filled('${inv.numGuests ?? ''}', width: 40),
            ])
          else if (inv.isFoodBill)
            _strip([
              _label('Bill No.'),
              _filled(inv.invoiceNumber ?? '${inv.id}', width: 50),
              _label('Table'),
              _filled(inv.tableLabel ?? '', flex: 2),
              _label('Covers -'),
              _filled('${inv.numGuests ?? ''}', width: 30),
            ])
          else
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

          // A dormitory stay is billed for one bed in a shared room, not the
          // room outright — said plainly right under the room line, the same
          // as BillDocument.jsx, or a guest reading "017 (Standard)" has no
          // way to tell this bill isn't for the whole room. bedLabel is null
          // on a buyout, which sells the whole dormitory the same as an
          // ordinary room, so that case prints "Dormitory (whole room)"
          // instead of naming a bed it has none of.
          if (!inv.isFoodBill && inv.isDormitory) ...[
            _strip([
              _label('Bed'),
              _filled(
                inv.bedLabel != null
                    ? 'Dormitory bed — ${inv.bedLabel}'
                    : 'Dormitory (whole room)',
                flex: 3,
              ),
            ]),
            _rule(),
          ],

          // ── The body: the stay to the left, the money column to the right ─
          //
          // The dark rule that splits the stay from Rs. and the lighter
          // hairline that splits Rs. from Ps. are painted ONCE here, as two
          // Positioned verticals behind both tables, rather than repeated as
          // a `left: BorderSide` on every one of the forty-odd rows below.
          // Stacking that many independent border segments end-to-end is what
          // read as the line being "cut" every few rows — a PDF viewer does
          // not always lay two abutting hairlines down flush, and a row with
          // no border at all (a bare blank cell) broke it outright. One
          // continuous rule behind everything can't come apart like that.
          pw.Stack(
            children: [
              pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.stretch,
                children: [
                  pw.Table(
                    columnWidths: const {
                      0: pw.FlexColumnWidth(),
                      1: pw.FixedColumnWidth(52),
                      2: pw.FixedColumnWidth(26),
                    },
                    children: [
                      pw.TableRow(
                        decoration: const pw.BoxDecoration(
                          color: _tintColor,
                          border: pw.Border(
                            top: pw.BorderSide(width: 0.6, color: _lineColor),
                            bottom: pw.BorderSide(width: 0.6, color: _lineColor),
                          ),
                        ),
                        children: [
                          pw.SizedBox(),
                          _cell(_rs, bold: true, align: pw.TextAlign.right),
                          _cell(_ps, bold: true, align: pw.TextAlign.right),
                        ],
                      ),
                      pw.TableRow(
                        children: [
                          _stayBlock(inv, isGst),
                          // The money cells stay for the column's rules; the
                          // figure that used to head them is gone — TOTAL
                          // AMOUNT below says it, same as the web memo
                          // (BillDocument.jsx) now leaves these two cells
                          // empty rather than repeating the gross.
                          _rsCell(null),
                          _psCell(null),
                        ],
                      ),
                      ..._chargeRows(inv, isGst),
                    ],
                  ),

                  // ── The money column proper ────────────────────────────
                  //
                  // TOTAL AMOUNT is the taxable value, not the gross: the tax
                  // sits inside every price here, so it is taken out before
                  // the two GST lines state it and added back by GRAND TOTAL.
                  pw.Table(
                    columnWidths: const {
                      0: pw.FlexColumnWidth(),
                      1: pw.FixedColumnWidth(52),
                      2: pw.FixedColumnWidth(26),
                    },
                    children: [
                      if (inv.discountAmount > 0)
                        _moneyRow(
                          'Less: Discount${_discountQualifier(inv)}',
                          -inv.discountAmount,
                        ),
                      _moneyRow(
                        // The rates printed above are tax-inclusive on a GST
                        // bill, so this first money-column figure is the
                        // value before tax, not a total of those rates —
                        // same relabelling BillDocument.jsx does
                        // (`T.taxableValue`), so the column doesn't read as
                        // double-charging the two GST lines right under it.
                        isGst ? 'TAXABLE VALUE (excl. GST)' : 'TOTAL AMOUNT',
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
                      _moneyRow(
                        'GRAND TOTAL',
                        inv.totalAmount,
                        strong: true,
                        rule: true,
                      ),
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
                        rule: true,
                        last: tenders.length <= 1,
                        // With one tender the method is said beneath the
                        // label, the way the web decorates it. With a split
                        // it is dropped here and each method gets its own
                        // row below, or the first would be named twice.
                        sub: tenders.length == 1 ? _tenderLine(tenders.single) : null,
                      ),
                      if (tenders.length > 1)
                        for (final (i, t) in tenders.indexed)
                          _moneyRow(
                            kPayLabels[t.method] ?? t.method,
                            t.amount,
                            last: i == tenders.length - 1,
                            sub: t.reference == null ? null : 'Txn No. ${t.reference}',
                          ),
                    ],
                  ),
                ],
              ),

              // The dark rule, at the boundary between the stay/particulars
              // column and the Rs. column — 52 + 26 in from the right, the
              // width of the two fixed money columns together.
              pw.Positioned(
                top: 0,
                bottom: 0,
                right: 78,
                child: pw.Container(width: 0.6, color: _lineColor),
              ),
              // The lighter hairline, between Rs. and Ps. — 26 in from the
              // right, the width of the Ps. column alone.
              pw.Positioned(
                top: 0,
                bottom: 0,
                right: 26,
                child: pw.Container(width: 0.6, color: _hairColor),
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
                    border: pw.Border(
                      bottom: pw.BorderSide(width: 0.4, color: _dotColor),
                    ),
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
    final eventFrom = _splitDateTime(inv.eventStartAt);
    final eventTo = _splitDateTime(inv.eventEndAt);

    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 3, horizontal: 2),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.stretch,
        children: [
          // A function: what it was, when it ran, the hire and what was sold
          // with it — the same rules the stay block uses, with the night
          // count gone, same as BillDocument.jsx's `isEventBill` branch.
          if (inv.isEventBill) ...[
            _strip([
              _label('Function'),
              _filled(inv.eventTitle ?? '', flex: 3),
            ]),
            _strip([
              _label('From'),
              _filled(eventFrom.$1, width: 76),
              _label('at'),
              _filled(eventFrom.$2, width: 60),
            ]),
            _strip([
              _label('To'),
              _filled(eventTo.$1, width: 76),
              _label('at'),
              _filled(eventTo.$2, width: 60),
            ]),
            _strip([
              _label(_rs),
              _filled(
                inv.roomCharges.isEmpty ? '' : _amt(inv.roomCharges.first.amount),
                width: 66,
              ),
              _label('Venue hire'),
            ]),
            _extraChargesStrip(inv.extras),
            if (inv.placeOfSupply != null)
              _strip([
                _label('Place of Supply'),
                _filled(inv.placeOfSupply!, width: 70, fine: true),
                _label('Reverse Charge'),
                _filled('No', width: 26, fine: true),
              ]),
            if (isGst && inv.roomSubtotal > 0)
              _strip([
                _label('SAC'),
                _filled(_sacVenue, width: 60, fine: true),
              ]),
          ],

          // A food bill has no stay behind it — a table, a room with nobody
          // checked in, or a takeaway — so none of the days/dates/rate rules
          // apply, same as BillDocument.jsx's `!isFoodBill && !isEventBill`
          // branch.
          //
          // The rate itself, its extras, the inclusive-GST note, late
          // checkout and the compliance lines all used to print right here,
          // folded into this one wide cell with their amounts as plain text.
          // They now print as their own ruled rows after this one (see
          // [_chargeRows]) so every rupee on the bill — not just the
          // gross at the top — sits inside the same ruled Rs./Ps. columns
          // the web memo's `.memo__extra--cols` reaches into, same as
          // BillDocument.jsx's own `blocks.map(...)`. Only the header that
          // every block shares stays here.
          if (!inv.isFoodBill &&
              !inv.isEventBill &&
              !_chargeBlocksDatesDiffer(inv)) ...[
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
          ],

          // Food keeps its items, on a room stay or on its own — a different
          // supply at a different rate, reported apart in GSTR-1, so a single
          // folded figure would leave nobody a way to check what they ate.
          if (inv.foodSubtotal > 0) _miscChargesBlock(inv, isGst),
        ],
      ),
    );
  }

  static const _sacAccommodation = '996311';
  static const _sacFood = '996331';
  static const _sacVenue = '997212';

  /// One line item to print as its own ruled row: `room` is null outside a
  /// multi-room booking (nothing to head the block with), non-null for each
  /// room of one. Mirrors BillDocument.jsx's own `blocks`: the backend
  /// already prefixes a multi-room booking's charge lines "Room 101 · ...",
  /// and [roomBillSections] is what splits them back apart; a single-room
  /// bill's flat [Invoice.roomCharges] becomes the one `room: null` block.
  static List<({String? room, BillLine base, List<BillLine> extras})>
  _chargeBlocks(Invoice inv) {
    final sections = roomBillSections(inv.roomCharges);
    if (sections != null) {
      return [
        for (final s in sections) (room: s.room, base: s.base, extras: s.extras),
      ];
    }
    if (inv.roomCharges.isEmpty) return const [];
    return [
      (
        room: null,
        base: inv.roomCharges.first,
        extras: inv.roomCharges.skip(1).toList(),
      ),
    ];
  }

  /// Whether the rooms of this stay ran different dates from each other —
  /// mirrors BillDocument.jsx's own `datesDiffer` check. Always false
  /// outside a stay bill or a multi-room one, since there is then only ever
  /// the one block to compare against itself.
  static bool _chargeBlocksDatesDiffer(Invoice inv) {
    if (inv.isFoodBill || inv.isEventBill) return false;
    final blocks = _chargeBlocks(inv);
    return {for (final b in blocks) '${b.base.firstDate}|${b.base.lastDate}'}
            .length >
        1;
  }

  /// The night after a room's last night is the day it checks out — same as
  /// BillDocument.jsx's `addOneDay`.
  static String? _addOneDay(String? dateKey) {
    if (dateKey == null) return null;
    final d = DateTime.tryParse(dateKey);
    if (d == null) return null;
    return _splitDateTime(d.add(const Duration(days: 1)).toIso8601String()).$1;
  }

  /// Every rupee the stay came to, each on its own ruled row — the room's
  /// own rate, every extra, a room's own total on a multi-room booking, the
  /// inclusive-GST note, late checkout, then the compliance lines. All of it
  /// used to sit as plain text inside the one wide cell [_stayBlock] prints;
  /// it is now appended here as siblings of that row in the same table, so
  /// every line's own amount sits inside the ruled Rs./Ps. columns and the
  /// vertical rule between them runs the full height of the body — the same
  /// shape `.memo__extra--cols`'s negative margin fakes on the web, drawn
  /// here for real with [_rsCell]/[_psCell].
  static List<pw.TableRow> _chargeRows(Invoice inv, bool isGst) {
    if (inv.isFoodBill || inv.isEventBill) return const [];
    final blocks = _chargeBlocks(inv);
    final datesDiffer = _chargeBlocksDatesDiffer(inv);
    final from = _splitDateTime(inv.actualCheckInAt ?? inv.checkInDate);
    final to = _splitDateTime(inv.actualCheckOutAt ?? inv.checkOutDate);
    final rows = <pw.TableRow>[];

    // The Rs./Ps. cells still carry [_rsCell]/[_psCell]'s own border even
    // with nothing to print — a bare `pw.SizedBox()` here drew no border at
    // all, which is what broke the vertical rule into dashes at every room
    // heading, "Rates above include GST", Place of Supply and SAC row.
    pw.TableRow blankRow(pw.Widget left, {pw.BoxDecoration? decoration}) =>
        pw.TableRow(
          decoration: decoration,
          children: [left, _rsCell(null), _psCell(null)],
        );

    for (final block in blocks) {
      if (block.room != null) {
        rows.add(
          blankRow(
            pw.Padding(
              padding: const pw.EdgeInsets.only(left: 2, top: 3),
              child: pw.Text(
                ascii(
                  'Room ${block.room} · ${block.base.nights} '
                  '${block.base.nights == 1 ? 'day' : 'days'}',
                ),
                style: pw.TextStyle(
                  fontSize: 7,
                  fontWeight: pw.FontWeight.bold,
                ),
              ),
            ),
            decoration: const pw.BoxDecoration(
              border: pw.Border(
                top: pw.BorderSide(width: 0.5, color: _roomRuleColor),
              ),
            ),
          ),
        );
        if (datesDiffer && block.base.firstDate != null) {
          rows.add(
            blankRow(
              _strip([
                _label('From'),
                _filled(_splitDateTime(block.base.firstDate).$1, width: 76),
                _label('at'),
                _filled(from.$2, width: 60),
              ]),
            ),
          );
          rows.add(
            blankRow(
              _strip([
                _label('To'),
                _filled(_addOneDay(block.base.lastDate) ?? '', width: 76),
                _label('at'),
                _filled(to.$2, width: 60),
              ]),
            ),
          );
        }
      }
      for (final line in [block.base, ...block.extras]) {
        rows.add(
          pw.TableRow(
            children: [
              pw.Padding(
                padding: pw.EdgeInsets.only(
                  left: block.room != null ? 6 : 3,
                  top: 1.5,
                  bottom: 1.5,
                ),
                child: pw.Text(
                  ascii(line.label),
                  style: const pw.TextStyle(fontSize: 7),
                ),
              ),
              _rsCell(line.amount),
              _psCell(line.amount),
            ],
          ),
        );
      }
      if (block.room != null && block.extras.isNotEmpty) {
        final total = block.extras.fold<num>(
          block.base.amount,
          (sum, e) => sum + e.amount,
        );
        rows.add(
          pw.TableRow(
            children: [
              pw.Padding(
                padding: const pw.EdgeInsets.only(left: 6, top: 1.5, bottom: 2),
                child: pw.Text(
                  ascii('Room ${block.room} total'),
                  style: pw.TextStyle(
                    fontSize: 7,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
              ),
              _rsCell(total, strong: false),
              _psCell(total, strong: false),
            ],
          ),
        );
      }
    }

    // On a GST bill the rates just printed are tax-inclusive — said once
    // here so the figures below (which pull the tax back out) don't read as
    // double-charging it, same as BillDocument.jsx's own `T.inclusiveNote`.
    if (isGst && blocks.isNotEmpty) {
      rows.add(
        blankRow(
          pw.Padding(
            padding: const pw.EdgeInsets.only(left: 2, top: 2),
            child: pw.Text(
              ascii('Rates above include GST'),
              style: const pw.TextStyle(fontSize: 6.5, color: PdfColors.grey700),
            ),
          ),
        ),
      );
    }

    // Overstay money, on its own ruled line same as every other charge —
    // dropped silently by the old per-block loop above when there was more
    // than one room, since nothing there ever reached [Invoice.extras].
    if (inv.lateCheckoutCharge > 0) {
      rows.add(
        pw.TableRow(
          children: [
            pw.Padding(
              padding: const pw.EdgeInsets.only(left: 3, top: 1.5, bottom: 1.5),
              child: pw.Text(
                ascii('Late checkout'),
                style: const pw.TextStyle(fontSize: 7),
              ),
            ),
            _rsCell(inv.lateCheckoutCharge),
            _psCell(inv.lateCheckoutCharge),
          ],
        ),
      );
    }

    if (inv.placeOfSupply != null) {
      rows.add(
        blankRow(
          _strip([
            _label('Place of Supply'),
            _filled(inv.placeOfSupply!, width: 70, fine: true),
            _label('Reverse Charge'),
            _filled('No', width: 26, fine: true),
          ]),
        ),
      );
    }
    if (isGst && inv.roomSubtotal > 0) {
      rows.add(
        blankRow(
          _strip([_label('SAC'), _filled(_sacAccommodation, width: 60, fine: true)]),
        ),
      );
    }

    return rows;
  }

  /// "Extra Charges" and whatever rides under it — an extra bed, AC, an
  /// overstay on a stay bill, or an add-on beyond the base hire on a
  /// function bill. Shared between [_stayBlock]'s two branches: the rule
  /// prints whether or not anything was added, same as BillDocument.jsx.
  static pw.Widget _extraChargesStrip(List<BillLine> extras) => pw.Padding(
    padding: const pw.EdgeInsets.symmetric(vertical: 1.5),
    child: pw.Row(
      // Top-aligned, not [_strip]'s usual baseline-at-the-bottom: a label
      // one line tall sitting beside a column of two or more extras has to
      // anchor to the column's first line, not its last — `.end` pulled
      // "Extra Charges" down to sit level with (and print over) the final
      // extra instead of beside the row it actually labels.
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        _label('Extra Charges'),
        pw.Expanded(
          child: extras.isEmpty
              ? _underline('')
              : pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.stretch,
                  children: [
                    for (final e in extras)
                      pw.Padding(
                        padding: const pw.EdgeInsets.only(left: 3),
                        child: pw.Row(
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
                      ),
                  ],
                ),
        ),
      ],
    ),
  );

  static pw.Widget _miscChargesBlock(Invoice inv, bool isGst) => pw.Padding(
    padding: const pw.EdgeInsets.only(top: 2),
    child: pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.stretch,
      children: [
        pw.Row(
          children: [
            pw.Expanded(
              child: pw.Text(
                ascii('Misc Charges'),
                style: pw.TextStyle(fontSize: 7, fontWeight: pw.FontWeight.bold),
              ),
            ),
            if (isGst)
              pw.Text(
                ascii('SAC $_sacFood'),
                style: const pw.TextStyle(fontSize: 6, color: PdfColors.grey700),
              ),
          ],
        ),
        for (final item in inv.foodItems)
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Expanded(
                child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    pw.Text(
                      ascii(item.name),
                      style: pw.TextStyle(
                        fontSize: 7,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                    pw.Text(
                      ascii('${_qty(item.quantity)} x ${_amt(item.unitPrice)}'),
                      style: const pw.TextStyle(
                        fontSize: 6,
                        color: PdfColors.grey700,
                      ),
                    ),
                  ],
                ),
              ),
              pw.Text(
                ascii(_amt(item.lineTotal)),
                style: pw.TextStyle(fontSize: 7, fontWeight: pw.FontWeight.bold),
              ),
            ],
          ),
      ],
    ),
  );

  /// A count printed without a trailing ".0" — quantities arrive as `num` and
  /// a whole one is still a double under the hood.
  static String _qty(num n) =>
      n == n.roundToDouble() ? '${n.toInt()}' : '$n';

  // ── Pieces ────────────────────────────────────────────────────────────────

  static pw.Widget _rule() => pw.Container(
    height: 0.5,
    margin: const pw.EdgeInsets.symmetric(vertical: 2),
    color: _lineColor,
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
        // Clear of the text's own descenders (g, p, y, j, Rs figures in
        // Devanagari) — at bottom: 1 the rule sat close enough to read as
        // cutting through them rather than running under the word.
        padding: const pw.EdgeInsets.only(bottom: 2.5),
        decoration: const pw.BoxDecoration(
          border: pw.Border(
            bottom: pw.BorderSide(width: 0.4, color: _dotColor),
          ),
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
  }) => pw.Container(
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

  /// The money cell itself — no border of its own. The vertical that used to
  /// be drawn per-cell (a `left: BorderSide` on every single row) is now one
  /// continuous line painted once over the whole body+totals block (see the
  /// `pw.Stack` in [_memo]): a hairline border repeated on forty-odd stacked
  /// table rows does not lay down as one straight rule in every PDF viewer —
  /// each row's segment can land a fraction of a point off its neighbours,
  /// which is what read as the line being "cut" every few rows.
  ///
  /// `null` prints no figure — a row with nothing to put in the money column
  /// (a room heading, "Rates above include GST", Place of Supply).
  static pw.Widget _rsCell(num? value, {bool strong = false}) => pw.Container(
    padding: const pw.EdgeInsets.only(left: 3, right: 3, top: 1.5, bottom: 1.5),
    child: pw.Text(
      value == null ? '' : ascii(_split(value).$1),
      textAlign: pw.TextAlign.right,
      style: pw.TextStyle(
        fontSize: strong ? 10 : 8,
        fontWeight: strong ? pw.FontWeight.bold : pw.FontWeight.normal,
      ),
    ),
  );

  static pw.Widget _psCell(num? value, {bool strong = false}) => pw.Container(
    padding: const pw.EdgeInsets.only(left: 3, right: 3, top: 1.5, bottom: 1.5),
    child: pw.Text(
      value == null ? '' : ascii(_split(value).$2),
      textAlign: pw.TextAlign.right,
      style: pw.TextStyle(
        fontSize: strong ? 10 : 8,
        fontWeight: strong ? pw.FontWeight.bold : pw.FontWeight.normal,
      ),
    ),
  );

  static pw.TableRow _moneyRow(
    String label,
    num value, {
    bool strong = false,
    bool rule = false,
    bool last = false,
    String? sub,
  }) => pw.TableRow(
    decoration: (rule || last)
        ? pw.BoxDecoration(
            border: pw.Border(
              top: rule
                  ? const pw.BorderSide(width: 0.6, color: _lineColor)
                  : pw.BorderSide.none,
              bottom: last
                  ? const pw.BorderSide(width: 0.6, color: _lineColor)
                  : pw.BorderSide.none,
            ),
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
        pw.Container(height: 0.5, color: _lineColor),
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

  // "(Leaving early, 50%)", "(50%)", "(Leaving early)" or nothing — the
  // reason first because it is what the guest asks about, the percentage
  // because it is what the desk agreed. Mirrors the web memo's
  // discountQualifier.
  static String _discountQualifier(Invoice inv) {
    final parts = <String>[
      if ((inv.discountReason ?? '').isNotEmpty) inv.discountReason!,
      if (inv.discountPercent > 0) '${inv.discountPercent}%',
    ];
    return parts.isEmpty ? '' : ' (${parts.join(', ')})';
  }

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
