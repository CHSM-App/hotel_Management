import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/domain/models/invoice.dart';
import 'package:hotel_manager/screens/billing/bill_pdf.dart';

/// The bill as a document.
///
/// Rendered against a real invoice payload copied from the server, so the file
/// is actually produced rather than merely compiling.
void main() {
  /// Invoice 9 from the property, verbatim.
  Invoice real() => Invoice.fromJson(const {
    'id': '44',
    'invoiceNumber': '9',
    'documentType': 'TAX_INVOICE',
    'billingSide': 'GST',
    'createdAt': '2026-08-26T16:09:11.792Z',
    'guestName': 'sagar',
    'guestPhone': '8262878298',
    'roomNumber': '001',
    'categoryName': 'Standard',
    'numGuests': 1,
    'checkInDate': '2026-08-26',
    'checkOutDate': '2026-08-27',
    'actualCheckInAt': '2026-08-26T15:41:55.872Z',
    'actualCheckOutAt': '2026-08-26T16:07:11.144Z',
    'checkOutTime': '11:00',
    'checkinMode': 'NIGHT_BASED',
    'roomCharges': [
      {'label': 'Standard ₹800', 'amount': 800, 'nights': 1},
      {'label': 'AC/Heater ₹200', 'amount': 200, 'nights': 1},
      {'label': 'Extra bed 2 × ₹300', 'amount': 600, 'nights': 1},
    ],
    'nightsSubtotal': 1600,
    'roomSubtotal': 1600,
    'lateCheckoutCharge': 0,
    'roomTaxable': 1523.8,
    'foodTaxable': 0,
    'foodSubtotal': 0,
    'cgstAmount': 38.1,
    'sgstAmount': 38.1,
    'cgstRatePercent': 2.5,
    'sgstRatePercent': 2.5,
    'discountAmount': 0,
    'roundOff': 0,
    'totalAmount': 1600,
    'advancePaid': 200,
    'advanceReceiptNumbers': '19',
    'balanceCollected': 1400,
    'paymentLines': [
      {'method': 'UPI', 'amount': 1400, 'reference': 'ufydu68585858'},
    ],
    'status': 'ISSUED',
    'lodgeName': 'Anand Executive Home Stay',
    'lodgeAddress': 'Near Moti Lake, Sawantwadi',
    'lodgePhone': '9421072971',
    'lodgeCity': 'Vengurla',
    'gstin': 'QWERTY1234',
    'isGstRegistered': true,
  });

  test('the document renders to a real PDF', () async {
    final bytes = await BillPdf.build(real());

    // %PDF- is the file's magic number. A renderer that threw would not get
    // this far, and one that produced an empty page would be far smaller.
    expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    expect(bytes.length, greaterThan(2000));

    // Kept for eyeballing beside the web's own output.
    // Kept for eyeballing beside the web's own output.
    final out = await File('build/bill-sample.pdf').create(recursive: true);
    out.writeAsBytesSync(bytes);
  });

  test('a void bill and a split still render', () async {
    // The same document, voided and settled two ways — the two branches the
    // renderer has that the happy path does not exercise.
    final split = Invoice.fromJson(const {
      'id': '45',
      'invoiceNumber': '10',
      'documentType': 'TAX_INVOICE',
      'billingSide': 'GST',
      'createdAt': '2026-08-26T16:09:11.792Z',
      'guestName': 'sagar',
      'roomNumber': '001',
      'checkInDate': '2026-08-26',
      'checkOutDate': '2026-08-27',
      'roomCharges': [
        {'label': 'Standard 800', 'amount': 800, 'nights': 1},
      ],
      'roomSubtotal': 1400,
      'roomTaxable': 1333.33,
      'cgstAmount': 33.33,
      'sgstAmount': 33.33,
      'totalAmount': 1400,
      'balanceCollected': 1400,
      'status': 'VOID',
      'voidReason': 'Wrong room',
      'paymentLines': [
        {'method': 'CASH', 'amount': 400},
        {'method': 'UPI', 'amount': 1000, 'reference': 'UTR7'},
      ],
      'lodgeName': 'Anand Executive Home Stay',
      'isGstRegistered': true,
    });
    final bytes = await BillPdf.build(split);
    expect(String.fromCharCodes(bytes.take(5)), '%PDF-');
    expect(split.tenders.length, 2);
  });

  test('the money column splits rupees from paise, rounding first', () {
    // The pad's Rs./Ps. pair is the shape the whole document hangs off.
    // Flooring a raw 95.999 would print 95 beside a 100-paise cell — a rupee
    // lost off a bill that has to add up in front of the guest paying it.
    expect(BillPdf.debugSplit(1523.8), ('1,523', '80'));
    expect(BillPdf.debugSplit(95.999), ('96', '00'));
    expect(BillPdf.debugSplit(-200), ('-200', '00'));
    expect(BillPdf.debugSplit(0), ('0', '00'));
    expect(BillPdf.debugSplit(123456.5), ('1,23,456', '50'));
  });

  test('amounts read in lakh and crore, not millions', () {
    // "One Million" at an Indian front desk is read twice and trusted once.
    expect(BillPdf.debugWords(1600), 'One Thousand Six Hundred Only');
    expect(BillPdf.debugWords(0), 'Zero Only');
    expect(BillPdf.debugWords(125000), 'One Lakh Twenty Five Thousand Only');
    expect(BillPdf.debugWords(10000000), 'One Crore Only');
  });

  test('the stay block reads its own rate and extras off the charges', () {
    final inv = real();
    expect(inv.nights, 1);
    // The room's own line, not the total divided — a stay with extras would
    // otherwise print a "per day" nobody agreed.
    expect(inv.perDay, 800);
    expect(inv.extras.map((e) => e.label), [
      'AC/Heater ₹200',
      'Extra bed 2 × ₹300',
    ]);
    expect(inv.gross, 1600);
  });

  test('every caption the memo states is actually in the file', () async {
    // Rendered uncompressed so the page's own text can be read back. A layout
    // that silently dropped a rule would still produce a valid PDF of about
    // the right size — only reading the words catches that.
    final doc = await BillPdf.build(real(), compress: false);
    // The page draws one word per show-text operator — [(TAX)]TJ [(INVOICE)]TJ
    // — so the literals are pulled out and rejoined before matching. Looking
    // for a phrase in the raw bytes would find nothing however correct the
    // document was.
    final raw = String.fromCharCodes(doc);
    final text = RegExp(
      r'\[\((.*?)\)\]TJ',
    ).allMatches(raw).map((m) => m.group(1)!).join(' ');

    for (final caption in [
      'TAX INVOICE',
      'Anand Executive Home Stay',
      'GSTIN No. QWERTY1234',
      'No.-',
      'Date -',
      'Name',
      'Mob. No.',
      'Room No.',
      'Persons -',
      'Rs.',
      'Ps.',
      'For',
      'Days',
      'From',
      'at',
      'Per day',
      'Extra Charges',
      'Place of Supply',
      'Reverse Charge',
      'SAC',
      'TOTAL AMOUNT',
      'CGST',
      'SGST',
      'GRAND TOTAL',
      'Less Advance if any',
      'Rec. No. 19',
      'Net Payment',
      'Inwords Rupees',
      'Jurisdiction',
      'Declaration',
      'Guest',
      'THANK YOU!',
      'For Prop. / Manager',
    ]) {
      expect(text, contains(caption), reason: 'the memo lost: $caption');
    }

    // And the figures, split across the Rs./Ps. columns.
    expect(text, contains('1,600'), reason: 'the gross');
    expect(
      text,
      contains('1,523'),
      reason: 'TOTAL AMOUNT is the taxable value',
    );
    expect(text, contains('1,400'), reason: 'net payment');
    expect(text, contains('One Thousand Six Hundred Only'));
    expect(text, contains('ufydu68585858'), reason: 'the UPI reference');
  });

  test('nothing the standard fonts cannot draw reaches the page', () async {
    // The document uses the standard-14 Helvetica, which has no Unicode
    // support. A "₹" or an em-dash arriving at the page is not an error and
    // not a wrong glyph — it is a *blank*, on a bill handed to a guest. This
    // is the guard for a string added later that carries one.
    final doc = await BillPdf.build(real(), compress: false);
    final text = RegExp(
      r'\[\((.*?)\)\]TJ',
    ).allMatches(String.fromCharCodes(doc)).map((m) => m.group(1)!).join(' ');

    final undrawable = text.runes.where((r) => r > 0xFF).toList();
    expect(
      undrawable,
      isEmpty,
      reason:
          'would print blank: '
          '${String.fromCharCodes(undrawable)}',
    );
    // The extras keep their amounts, written the way the memo writes money.
    expect(text, contains('Rs.200'), reason: 'AC/Heater ₹200');
  });

  test('the sanitiser folds, never drops', () {
    expect(BillPdf.ascii('AC/Heater ₹200'), 'AC/Heater Rs.200');
    expect(BillPdf.ascii('VOID — wrong room'), 'VOID - wrong room');
    expect(BillPdf.ascii('Cash 600 · UPI 400'), 'Cash 600 . UPI 400');
    // Plain text is returned untouched — the common case must not be mangled.
    expect(
      BillPdf.ascii('Anand Executive Home Stay'),
      'Anand Executive Home Stay',
    );
  });
}
