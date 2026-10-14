import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../core/constant.dart';
import '../../domain/models/me.dart';
import '../../domain/models/quote.dart';
import '../../domain/models/room.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import '../reports/report_pdf_style.dart';

const Map<String, String> kBedSizeLabel = {'SINGLE': 'Single', 'DOUBLE': 'Double', 'QUEEN': 'Queen', 'KING': 'King'};
const Map<String, String> kBathroomTypeLabel = {'ATTACHED': 'Attached bathroom', 'COMMON': 'Common bathroom'};

/// One room priced by the simulator, as handed to the quotation.
class QuotedRoom {
  final RoomListing room;
  final String fromDate;
  final String toDate;
  final PriceSimulation result;

  const QuotedRoom({required this.room, required this.fromDate, required this.toDate, required this.result});
}

/// The quotation the Price simulator downloads — a real (selectable-text,
/// multi-page) PDF, the native equivalent of
/// frontend/src/pages/lodge/QuotationDocument.jsx + quotationPdf.js. An A4
/// letter: letterhead, a "prepared for" block (only when a name or phone
/// was typed in), a glance strip, one table per room and a sign-off.
class QuotationPdf {
  static Future<String> download(
    List<QuotedRoom> rooms, {
    required num total,
    required Lodge? lodge,
    String? guestName,
    String? guestPhone,
    String? preparedBy,
  }) async {
    final bytes = await build(
      rooms,
      total: total,
      lodge: lodge,
      guestName: guestName,
      guestPhone: guestPhone,
      preparedBy: preparedBy,
    );
    final now = DateTime.now();
    final day = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    return saveBytesToDevice(bytes, 'quotation-$day.pdf');
  }

  static Future<void> share(
    List<QuotedRoom> rooms, {
    required num total,
    required Lodge? lodge,
    String? guestName,
    String? guestPhone,
    String? preparedBy,
  }) async {
    final bytes = await build(
      rooms,
      total: total,
      lodge: lodge,
      guestName: guestName,
      guestPhone: guestPhone,
      preparedBy: preparedBy,
    );
    final now = DateTime.now();
    final day = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    await shareBytesFromDevice(bytes, 'quotation-$day.pdf');
  }

  static Future<void> print(
    List<QuotedRoom> rooms, {
    required num total,
    required Lodge? lodge,
    String? guestName,
    String? guestPhone,
    String? preparedBy,
  }) async {
    final bytes = await build(
      rooms,
      total: total,
      lodge: lodge,
      guestName: guestName,
      guestPhone: guestPhone,
      preparedBy: preparedBy,
    );
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static Future<Uint8List?> _fetchLogo(String? url) async {
    if (url == null) return null;
    try {
      final res = await Dio().get<List<int>>('$baseUrl$url', options: Options(responseType: ResponseType.bytes));
      final data = res.data;
      return data == null ? null : Uint8List.fromList(data);
    } catch (_) {
      return null;
    }
  }

  static Future<Uint8List> build(
    List<QuotedRoom> rooms, {
    required num total,
    required Lodge? lodge,
    String? guestName,
    String? guestPhone,
    String? preparedBy,
  }) async {
    final logo = await _fetchLogo(lodge?.logoUrl);
    final name = (lodge?.name.isNotEmpty ?? false) ? lodge!.name : 'Quotation';
    final address = [lodge?.address, lodge?.city, lodge?.state].whereType<String>().where((s) => s.isNotEmpty).join(', ');
    final contact = [
      if (lodge?.phone?.isNotEmpty ?? false) 'Phone ${lodge!.phone}',
      if ((lodge?.isGstRegistered ?? false) && (lodge?.gstin?.isNotEmpty ?? false)) 'GSTIN ${lodge!.gstin}',
    ].join(' . ');
    final now = DateTime.now();
    final date = ReportPdfStyle.dateOnly('${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}');

    final hasGuest = (guestName?.trim().isNotEmpty ?? false) || (guestPhone?.trim().isNotEmpty ?? false);
    final totalNights = rooms.fold<int>(0, (sum, r) => sum + r.result.nightCount);
    final arrival = ([...rooms.map((r) => r.fromDate)]..sort()).first;
    final departure = ([...rooms.map((r) => r.toDate)]..sort()).last;
    final runningHead = '${ReportPdfStyle.ascii(name)} - quotation, $date';

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
                    ReportPdfStyle.ascii('$name . Quotation dated $date'),
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
          _letterhead(name, address, contact, logo, date, preparedBy),
          pw.SizedBox(height: 14),
          pw.Container(height: 1.2, color: ReportPdfStyle.ink),
          pw.SizedBox(height: 14),

          if (hasGuest) _preparedFor(guestName, guestPhone),
          _glance(rooms.length, totalNights, arrival, departure),
          pw.SizedBox(height: 14),

          for (final r in rooms) ..._roomBlock(r),

          pw.SizedBox(height: 10),
          _termsAndTotals(rooms, total),

          pw.SizedBox(height: 24),
          _signOff(name),
        ],
      ),
    );

    return doc.save();
  }

  static pw.Widget _letterhead(String name, String address, String contact, Uint8List? logo, String date, String? preparedBy) {
    return pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        if (logo != null) ...[
          pw.Container(height: 36, width: 36, child: pw.Image(pw.MemoryImage(logo), fit: pw.BoxFit.contain)),
          pw.SizedBox(width: 10),
        ],
        pw.Expanded(
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text(ReportPdfStyle.ascii(name), style: pw.TextStyle(fontSize: 17, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.ink)),
              if (address.isNotEmpty || contact.isNotEmpty) ...[
                pw.SizedBox(height: 3),
                pw.Text(
                  ReportPdfStyle.ascii([address, contact].where((s) => s.isNotEmpty).join('\n')),
                  style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted),
                ),
              ],
            ],
          ),
        ),
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.end,
          children: [
            pw.Text('QUOTATION', style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.ink)),
            pw.SizedBox(height: 4),
            pw.Text('Date  $date', style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted)),
            if (preparedBy != null && preparedBy.isNotEmpty) ...[
              pw.SizedBox(height: 2),
              pw.Text(ReportPdfStyle.ascii('Prepared by  $preparedBy'), style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted)),
            ],
          ],
        ),
      ],
    );
  }

  static pw.Widget _preparedFor(String? guestName, String? guestPhone) {
    final name = guestName?.trim() ?? '';
    final phone = guestPhone?.trim() ?? '';
    return pw.Padding(
      padding: const pw.EdgeInsets.only(bottom: 14),
      child: pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text('PREPARED FOR', style: pw.TextStyle(fontSize: 7, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.muted)),
          pw.SizedBox(height: 3),
          if (name.isNotEmpty)
            pw.Text(ReportPdfStyle.ascii(name), style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.ink)),
          if (phone.isNotEmpty)
            pw.Text(ReportPdfStyle.ascii(phone), style: pw.TextStyle(fontSize: 9, color: ReportPdfStyle.muted)),
        ],
      ),
    );
  }

  static pw.Widget _glance(int roomCount, int totalNights, String arrival, String departure) {
    return ReportPdfStyle.tiles([
      ('Rooms', '$roomCount'),
      ('Nights', '$totalNights'),
      ('Arrival', ReportPdfStyle.dateOnly(arrival)),
      ('Departure', ReportPdfStyle.dateOnly(departure)),
    ], width: ReportPdfStyle.contentWidthPortrait, perRow: 4);
  }

  static String _roomFacts(RoomListing room) {
    final bed = room.beds.isNotEmpty ? room.beds.map((b) => '${kBedSizeLabel[b.size] ?? b.size} bed').join(', ') : null;
    final bathroom = room.bathroomType == null ? null : kBathroomTypeLabel[room.bathroomType!] ?? room.bathroomType;
    final occupancy = room.maxOccupancy == null ? null : 'up to ${room.maxOccupancy} guest${room.maxOccupancy == 1 ? '' : 's'}';
    return [bed, bathroom, occupancy].whereType<String>().join(' . ');
  }

  // A quotation line prints its rate on its own column, so the trailing
  // "₹1,200" the simulator folds into a room line's label has to come off —
  // a counted extra ("Blanket 2 × ₹50") keeps its, since that's the
  // quantity, not the rate. Mirrors lineName() in QuotationDocument.jsx.
  static String _lineName(String label) {
    if (label.contains('×')) return label;
    return label.replaceAll(RegExp(r'\s*(Rs\.|₹)\s?[\d,]+(\.\d+)?$'), '');
  }

  static List<pw.Widget> _roomBlock(QuotedRoom r) {
    final facts = _roomFacts(r.room);
    return [
      pw.Container(
        padding: const pw.EdgeInsets.only(bottom: 6),
        decoration: const pw.BoxDecoration(border: pw.Border(bottom: pw.BorderSide(width: 0.8, color: ReportPdfStyle.ink))),
        child: pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    ReportPdfStyle.ascii('Room ${r.room.roomNumber} . ${r.room.category.name}'),
                    style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.ink),
                  ),
                  if (facts.isNotEmpty)
                    pw.Text(ReportPdfStyle.ascii(facts), style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted)),
                ],
              ),
            ),
            pw.Text(
              ReportPdfStyle.ascii(
                '${ReportPdfStyle.dateOnly(r.fromDate)} to ${ReportPdfStyle.dateOnly(r.toDate)} . ${r.result.nightCount} night${r.result.nightCount == 1 ? '' : 's'}',
              ),
              style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted),
            ),
          ],
        ),
      ),
      pw.SizedBox(height: 6),
      ReportPdfStyle.table(
        columns: const [
          ReportPdfColumn('Room and charges', flex: 3),
          ReportPdfColumn('Rate / night', flex: 1, align: pw.TextAlign.right),
          ReportPdfColumn('Nights', flex: 1, align: pw.TextAlign.right),
          ReportPdfColumn('Amount', flex: 1, align: pw.TextAlign.right),
        ],
        rows: [
          for (final line in r.result.lines)
            [
              _lineName(line.label),
              (line.nights ?? r.result.nightCount) > 0
                  ? ReportPdfStyle.amount(line.amount / (line.nights ?? r.result.nightCount))
                  : '',
              '${line.nights ?? r.result.nightCount}',
              ReportPdfStyle.amount(line.amount),
            ],
        ],
        totals: ['Room ${r.room.roomNumber} total', '', '', ReportPdfStyle.amount(r.result.total)],
      ),
      pw.SizedBox(height: 14),
    ];
  }

  static pw.Widget _termsAndTotals(List<QuotedRoom> rooms, num total) {
    final totalNights = rooms.fold<int>(0, (sum, r) => sum + r.result.nightCount);
    return pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.Expanded(
          flex: 3,
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text('TERMS AND CONDITIONS', style: pw.TextStyle(fontSize: 7, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.muted)),
              pw.SizedBox(height: 4),
              for (final (i, term) in _terms.indexed)
                pw.Padding(
                  padding: const pw.EdgeInsets.only(bottom: 2),
                  child: pw.Text('${i + 1}. $term', style: pw.TextStyle(fontSize: 6.5, color: ReportPdfStyle.muted)),
                ),
              pw.SizedBox(height: 8),
              pw.Text(
                ReportPdfStyle.ascii('Amount in words: ${rupeesInWords(total)}'),
                style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.ink),
              ),
            ],
          ),
        ),
        pw.SizedBox(width: 16),
        pw.Expanded(
          flex: 2,
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.stretch,
            children: [
              for (final r in rooms)
                pw.Padding(
                  padding: const pw.EdgeInsets.only(bottom: 4),
                  child: pw.Row(
                    children: [
                      pw.Expanded(
                        child: pw.Text(
                          'Room ${r.room.roomNumber} . ${r.result.nightCount} night${r.result.nightCount == 1 ? '' : 's'}',
                          style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted),
                        ),
                      ),
                      pw.Text(ReportPdfStyle.amount(r.result.total), style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.ink)),
                    ],
                  ),
                ),
              pw.Container(height: 0.8, color: ReportPdfStyle.ink, margin: const pw.EdgeInsets.symmetric(vertical: 4)),
              pw.Row(
                children: [
                  pw.Expanded(child: pw.Text('Total', style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.ink))),
                  pw.Text(ReportPdfStyle.amount(total), style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold, color: ReportPdfStyle.ink)),
                ],
              ),
              pw.SizedBox(height: 3),
              pw.Text(
                '${rooms.length} room${rooms.length == 1 ? '' : 's'} . $totalNights night${totalNights == 1 ? '' : 's'}',
                style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted),
              ),
            ],
          ),
        ),
      ],
    );
  }

  static pw.Widget _signOff(String name) {
    return pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.end,
      children: [
        pw.Expanded(
          child: pw.Text(
            ReportPdfStyle.ascii('Thank you for considering $name. We look forward to hosting you.'),
            style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted),
          ),
        ),
        pw.SizedBox(width: 20),
        pw.Column(
          children: [
            pw.SizedBox(width: 120, height: 30),
            pw.Container(width: 120, height: 0.6, color: ReportPdfStyle.ink),
            pw.SizedBox(height: 3),
            pw.Text(ReportPdfStyle.ascii('For $name'), style: pw.TextStyle(fontSize: 7.5, fontWeight: pw.FontWeight.bold)),
            pw.Text('Authorised signatory', style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted)),
          ],
        ),
      ],
    );
  }

  static const _terms = [
    'This quotation is valid only for the rooms and dates mentioned above.',
    'Rates are as on the date of this quotation. If room rates or charges change later, this quotation will not '
        'be considered and a fresh quotation will be issued.',
    'This is a quotation only. It is not a bill, and it does not confirm or hold a booking.',
    'Rooms are subject to availability at the time of booking.',
    'Any change in rooms, dates, number of guests or extras will change the amount.',
    'Services not listed above are charged separately.',
  ];
}

// ── Amount in words ──────────────────────────────────────────────────────

const _kOnes = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const _kTens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

String _underHundred(int n) => n < 20 ? _kOnes[n] : '${_kTens[n ~/ 10]}${n % 10 != 0 ? ' ${_kOnes[n % 10]}' : ''}';
String _underThousand(int n) => n < 100 ? _underHundred(n) : '${_kOnes[n ~/ 100]} hundred${n % 100 != 0 ? ' ${_underHundred(n % 100)}' : ''}';

/// Whole numbers in the Indian grouping — thousand, lakh, crore. Mirrors
/// wholeInWords() in quotationPdf.js.
String _wholeInWords(int n) {
  if (n == 0) return 'zero';
  final parts = <String>[];
  final crore = n ~/ 10000000;
  final lakh = (n % 10000000) ~/ 100000;
  final thousand = (n % 100000) ~/ 1000;
  final rest = n % 1000;
  if (crore > 0) parts.add('${_wholeInWords(crore)} crore');
  if (lakh > 0) parts.add('${_underHundred(lakh)} lakh');
  if (thousand > 0) parts.add('${_underHundred(thousand)} thousand');
  if (rest > 0) parts.add(_underThousand(rest));
  return parts.join(' ');
}

/// "Rupees four thousand four hundred only" — mirrors rupeesInWords() in
/// quotationPdf.js.
String rupeesInWords(num amount) {
  final paiseTotal = (amount * 100).round();
  if (paiseTotal < 0) return '';
  final rupees = paiseTotal ~/ 100;
  final paise = paiseTotal % 100;
  final words = _wholeInWords(rupees);
  final capped = '${words[0].toUpperCase()}${words.substring(1)}';
  return 'Rupees $capped${paise > 0 ? ' and ${_underHundred(paise)} paise' : ''} only';
}
