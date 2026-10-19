import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../domain/models/report.dart';
import '../bookings/receipt_download.dart';
import '../bookings/receipt_share.dart';
import 'booking_register_rows.dart';
import 'report_pdf_style.dart';

/// The booking report, as a real (selectable-text) PDF — the native
/// equivalent of frontend/src/pages/lodge/bookingReportFile.js's
/// buildBookingReportPdf(), section for section: masthead, explanatory note,
/// headline tiles, then the three numbered parts (money received, stays
/// checking in with the bills issued for them, and the register).
///
/// Landscape A4, same as the web version — the register carries nineteen
/// columns once a bill's figures are on it, and portrait would force either
/// a wrapped row or unreadable type.
class BookingReportPdf {

  static Future<String> download(BookingsReport report) async {
    final bytes = await build(report);
    return saveBytesToDevice(bytes, _filename(report));
  }

  static Future<void> share(BookingsReport report) async {
    final bytes = await build(report);
    await shareBytesFromDevice(bytes, _filename(report));
  }

  static Future<void> print(BookingsReport report) async {
    final bytes = await build(report);
    await Printing.layoutPdf(onLayout: (_) async => bytes);
  }

  static String _filename(BookingsReport report) {
    final period = ReportPdfStyle.periodLabel(report.fromDate, report.toDate).replaceAll(' ', '-');
    final side = report.billingSide != 'ALL' ? '-${_billingSideShort(report.billingSide)}' : '';
    return 'Booking-report-$period$side.pdf';
  }

  static String _billingSideShort(String side) => switch (side) {
    'GST' => 'GST',
    'NON_GST' => 'NonGST',
    _ => 'All',
  };

  static String _billingSideLabel(String side) => switch (side) {
    'GST' => 'GST bills only',
    'NON_GST' => 'Non-GST bills only',
    _ => 'All bills',
  };

  // The advance a bill deducted is not sent by the server under that name —
  // it is the sum of advancePaid over billed, non-cancelled rows. Derived
  // here exactly as bookingReportFile.js's withDerived() does, so the PDF's
  // "Less: advance deducted" line matches what the web report would print.
  static num _advanceDeducted(BookingsReport report) {
    num sum = 0;
    for (final b in report.bookings) {
      if (b.status != 'CANCELLED' && b.advancePaid != null) sum += b.advancePaid!;
    }
    return (sum * 100).round() / 100;
  }

  static Future<Uint8List> build(BookingsReport rawReport) async {
    final bills = rawReport.summary.bills.withAdvanceDeducted(_advanceDeducted(rawReport));
    final summary = rawReport.summary;
    final period = ReportPdfStyle.periodLabel(rawReport.fromDate, rawReport.toDate);
    final name = rawReport.lodgeName.isEmpty ? 'Booking report' : rawReport.lodgeName;
    final generatedAt = DateTime.tryParse(rawReport.generatedAt ?? '') ?? DateTime.now();
    final cancelled = summary.cancelled;
    final runningHead = '${ReportPdfStyle.ascii(name)} - booking report, $period';

    final doc = pw.Document();

    doc.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4.landscape.copyWith(
          marginLeft: ReportPdfStyle.margin,
          marginRight: ReportPdfStyle.margin,
          marginTop: ReportPdfStyle.margin,
          marginBottom: ReportPdfStyle.margin + 16,
        ),
        header: (context) => context.pageNumber == 1
            ? pw.SizedBox()
            : pw.Padding(
                padding: const pw.EdgeInsets.only(bottom: 10),
                child: pw.Text(
                  runningHead,
                  style: pw.TextStyle(fontSize: 7.5, color: ReportPdfStyle.muted),
                ),
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
                    ReportPdfStyle.ascii(
                      '$name . Booking report, $period . All amounts in Rs. . '
                      'Cancelled bookings excluded from all money figures except cancellation charges kept.',
                    ),
                    style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted),
                    maxLines: 1,
                    overflow: pw.TextOverflow.clip,
                  ),
                ),
                pw.Text(
                  'Page ${context.pageNumber} of ${context.pagesCount}',
                  style: pw.TextStyle(fontSize: 7, color: ReportPdfStyle.muted),
                ),
              ],
            ),
          ],
        ),
        build: (context) => [
          ReportPdfStyle.masthead(
            name: name,
            gstin: rawReport.gstin,
            title: 'Booking report',
            subtitle: '$period   .   ${_billingSideLabel(rawReport.billingSide)}',
            generatedAt: generatedAt,
          ),
          ReportPdfStyle.note(
            'This report has three parts. Part 1 is money received in the period, counted on the date each payment '
            'came in, whichever stay it was for. Part 2 is the stays that checked in during the period and the bills '
            'issued for them, counted by check-in date. Part 3 is the register of those stays, one row each. Parts 1 '
            'and 2 are dated differently and are not expected to agree. Cancelled bookings are listed but excluded '
            'from every money figure, except the cancellation charges kept on them, which part 1 counts as income. '
            'All amounts in rupees.',
          ),
          ReportPdfStyle.tiles([
            ('Money received in period', ReportPdfStyle.amount(summary.totalCollected)),
            ('Stays checking in', '${summary.activeBookings}'),
            ('Room nights', '${summary.roomNights}'),
            ('Bills issued', '${bills.count}'),
            ('Billed total', ReportPdfStyle.amount(bills.totalAmount)),
            ('Tax on bills (CGST + SGST)', ReportPdfStyle.amount(bills.totalTax)),
          ], width: ReportPdfStyle.contentWidthLandscape, perRow: 6),
          pw.SizedBox(height: 14),

          // ---- Part 1 ------------------------------------------------------
          ReportPdfStyle.heading('1. Money received in $period',
              subtitle: 'Cash basis - dated by when the money came in'),
          ReportPdfStyle.tiles(
            summary.cancellationChargesKept > 0
                ? [
                    ('Advances received', ReportPdfStyle.amount(summary.advanceCollected)),
                    ('Final payments received', ReportPdfStyle.amount(summary.balanceCollected)),
                    ('Cancellation charges kept', ReportPdfStyle.amount(summary.cancellationChargesKept)),
                    ('Total received', ReportPdfStyle.amount(summary.totalCollected)),
                  ]
                : [
                    ('Advances received', ReportPdfStyle.amount(summary.advanceCollected)),
                    ('Final payments received', ReportPdfStyle.amount(summary.balanceCollected)),
                    ('Total received', ReportPdfStyle.amount(summary.totalCollected)),
                  ],
            width: ReportPdfStyle.contentWidthLandscape,
            perRow: summary.cancellationChargesKept > 0 ? 4 : 3,
          ),
          pw.SizedBox(height: 8),
          ReportPdfStyle.note(
            'An advance is dated by the receipt that acknowledged it; a final payment by the date of the bill it '
            "settled. This includes money received for stays in other periods, and excludes money for this period's "
            'stays that came in earlier or later.'
            '${summary.cancellationChargesKept > 0 ? ' A cancellation charge is money kept back from an advance, or collected from the guest while cancelling, dated by the day of cancellation. It sits outside the mode and stay tables below, which foot to advances plus final payments.' : ''}',
          ),
          ReportPdfStyle.subheading('By payment mode'),
          _moneyTable(summary),
          if (summary.collections.byStayPeriod.isNotEmpty) ...[
            pw.SizedBox(height: 10),
            ReportPdfStyle.subheading('By the stay it was for'),
            _stayPeriodTable(summary),
          ],
          pw.SizedBox(height: 14),

          // ---- Part 2 ------------------------------------------------------
          ReportPdfStyle.heading('2. Stays checking in $period',
              subtitle: 'By check-in date - the stays listed in part 3'),
          ReportPdfStyle.tiles([
            ('Bookings', '${summary.totalBookings}'),
            for (final entry in kBookingStatusLabel.entries)
              (entry.value, '${summary.statusCount(entry.key)}'),
            ('Room nights', '${summary.roomNights}'),
          ], width: ReportPdfStyle.contentWidthLandscape),
          pw.SizedBox(height: 10),
          ReportPdfStyle.tiles([
            ('Booked value', ReportPdfStyle.amount(summary.bookedValue)),
            ('Bills issued', '${bills.count}'),
            ('Billed total', ReportPdfStyle.amount(bills.totalAmount)),
            ('Not yet billed', '${summary.unbilledCount} ${summary.unbilledCount == 1 ? 'stay' : 'stays'}'),
            ('Not yet billed - booked value', ReportPdfStyle.amount(summary.unbilledValue)),
            ('Advance held on these stays', ReportPdfStyle.amount(summary.stayAdvance)),
          ], width: ReportPdfStyle.contentWidthLandscape, perRow: 6),
          pw.SizedBox(height: 8),
          ReportPdfStyle.note(
            'Booked value is what the stays were priced at; billed total is what the issued bills charged (after any '
            'discount). The two differ by the stays not yet billed and by discounts given.'
            '${cancelled.count > 0 ? ' ${cancelled.count} cancelled ${cancelled.count == 1 ? 'booking' : 'bookings'} worth ${ReportPdfStyle.amount(cancelled.bookedValue)} is counted in the bookings above but excluded from room nights and from every money figure.' : ''}',
          ),
          ReportPdfStyle.subheading('Bills issued for these stays'),
          ReportPdfStyle.equation([
            ('Gross amount (tax inside)', ReportPdfStyle.amount(bills.grossAmount), false),
            ('Less: discount', ReportPdfStyle.amount(bills.discountAmount), false),
            ('Net amount', ReportPdfStyle.amount(bills.netAmount), true),
            ('Less: CGST + SGST inside the net amount', ReportPdfStyle.amount(bills.totalTax), false),
            ('Taxable value', ReportPdfStyle.amount(bills.taxableValue), true),
          ]),
          ReportPdfStyle.equation([
            ('Taxable value', ReportPdfStyle.amount(bills.taxableValue), false),
            ('Add: CGST', ReportPdfStyle.amount(bills.cgstAmount), false),
            ('Add: SGST', ReportPdfStyle.amount(bills.sgstAmount), false),
            ('Add: round off', ReportPdfStyle.amount(bills.roundOff), false),
            ('Billed total', ReportPdfStyle.amount(bills.totalAmount), true),
          ]),
          ReportPdfStyle.note(
            'Prices are GST-inclusive, so the taxable value is the net amount with the tax inside it taken out - it '
            "is not the gross. Tax acknowledged on receipt vouchers for advances is not shown here; it is reported "
            "on each stay's final bill.",
          ),
          ReportPdfStyle.subheading('Tax by supply'),
          _supplyTable(rawReport, bills),
          pw.SizedBox(height: 10),
          ReportPdfStyle.subheading('By document type'),
          _documentTypeTable(summary, bills),
          pw.SizedBox(height: 10),
          ReportPdfStyle.subheading('Settlement of these bills'),
          ReportPdfStyle.equation([
            ('Billed total', ReportPdfStyle.amount(bills.totalAmount), false),
            ('Less: advance deducted on the bills', ReportPdfStyle.amount(bills.advanceDeducted), false),
            ('Less: balance collected on the bills', ReportPdfStyle.amount(summary.stayBalance), false),
            ('Balance still due', ReportPdfStyle.amount(summary.stayBalanceDue), true),
          ]),
          ReportPdfStyle.note(
            'The advance a bill deducted is the advance held when it was issued. Money received on these bills '
            'appears in part 1 only if it came in during this period.',
          ),
          pw.NewPage(),

          // ---- Part 3 --------------------------------------------------
          // Three registers, not one - a bill, an advance and a cancellation
          // settle differently and a reader checking one against its source
          // document should not have to pick it out of a mixed list.
          ReportPdfStyle.heading(
            '3. Register - stays checking in $period',
            subtitle: 'Split by what settled the money - a bill, an advance, or a cancellation',
          ),
          ..._registerSections(rawReport),
        ],
      ),
    );

    return doc.save();
  }

  // ── Section 1 tables ──────────────────────────────────────────────────

  static pw.Widget _moneyTable(BookingsReportSummary summary) {
    const modes = ['CASH', 'UPI', 'CARD', 'UNRECORDED'];
    final rows = <List<String>>[];
    for (final mode in modes) {
      final t = summary.byPaymentMode[mode];
      if (t == null || (mode == 'UNRECORDED' && t.total == 0)) continue;
      rows.add([_paymentModeLabel(mode), ReportPdfStyle.amount(t.advance), ReportPdfStyle.amount(t.balance), ReportPdfStyle.amount(t.total)]);
    }
    final modeSplitTotal = summary.advanceCollected + summary.balanceCollected;
    return ReportPdfStyle.table(
      columns: const [
        ReportPdfColumn('Mode', flex: 3),
        ReportPdfColumn('Advances', flex: 1.4, align: pw.TextAlign.right),
        ReportPdfColumn('Final payments', flex: 1.4, align: pw.TextAlign.right),
        ReportPdfColumn('Total', flex: 1.4, align: pw.TextAlign.right),
      ],
      rows: rows,
      totals: [
        'Total (advances + final payments)',
        ReportPdfStyle.amount(summary.advanceCollected),
        ReportPdfStyle.amount(summary.balanceCollected),
        ReportPdfStyle.amount(modeSplitTotal),
      ],
    );
  }

  static pw.Widget _stayPeriodTable(BookingsReportSummary summary) {
    final byStay = summary.collections.byStayPeriod;
    final modeSplitTotal = summary.advanceCollected + summary.balanceCollected;
    List<String> row(String key, String label) {
      final t = byStay[key];
      return [label, ReportPdfStyle.amount(t?.advance ?? 0), ReportPdfStyle.amount(t?.balance ?? 0), ReportPdfStyle.amount(t?.total ?? 0)];
    }

    return ReportPdfStyle.table(
      columns: const [
        ReportPdfColumn('Money received was for', flex: 3),
        ReportPdfColumn('Advances', flex: 1.4, align: pw.TextAlign.right),
        ReportPdfColumn('Final payments', flex: 1.4, align: pw.TextAlign.right),
        ReportPdfColumn('Total', flex: 1.4, align: pw.TextAlign.right),
      ],
      rows: [
        row('EARLIER', 'Stays that checked in before this period'),
        row('THIS', 'Stays checking in this period'),
        row('LATER', 'Stays checking in after this period'),
      ],
      totals: [
        'Total (advances + final payments)',
        ReportPdfStyle.amount(summary.advanceCollected),
        ReportPdfStyle.amount(summary.balanceCollected),
        ReportPdfStyle.amount(modeSplitTotal),
      ],
    );
  }

  static String _paymentModeLabel(String mode) => switch (mode) {
    'CASH' => 'Cash',
    'UPI' => 'UPI',
    'CARD' => 'Card',
    _ => 'Not recorded',
  };

  // ── Section 2 tables ──────────────────────────────────────────────────

  static const _sacRooms = '996311';
  static const _sacFood = '996331';

  static pw.Widget _supplyTable(BookingsReport report, ReportBillTotals bills) {
    List<String> row(String label, String sac, num taxable, num cgst, num sgst) =>
        [label, sac, ReportPdfStyle.amount(taxable), ReportPdfStyle.amount(cgst), ReportPdfStyle.amount(sgst), ReportPdfStyle.amount(cgst + sgst)];

    return ReportPdfStyle.table(
      columns: const [
        ReportPdfColumn('Supply', flex: 2.2),
        ReportPdfColumn('SAC', flex: 1),
        ReportPdfColumn('Taxable value', flex: 1.4, align: pw.TextAlign.right),
        ReportPdfColumn('CGST', flex: 1.2, align: pw.TextAlign.right),
        ReportPdfColumn('SGST', flex: 1.2, align: pw.TextAlign.right),
        ReportPdfColumn('Total tax', flex: 1.3, align: pw.TextAlign.right),
      ],
      rows: [
        row('Accommodation', _sacRooms, bills.roomTaxable, bills.roomCgst, bills.roomSgst),
        if (report.servesFood) row('Food', _sacFood, bills.foodTaxable, bills.foodCgst, bills.foodSgst),
      ],
      totals: report.servesFood
          ? ['Total', '', ReportPdfStyle.amount(bills.taxableValue), ReportPdfStyle.amount(bills.cgstAmount), ReportPdfStyle.amount(bills.sgstAmount),
              ReportPdfStyle.amount(bills.totalTax)]
          : null,
    );
  }

  static pw.Widget _documentTypeTable(BookingsReportSummary summary, ReportBillTotals bills) {
    const types = ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'CASH_RECEIPT'];
    List<String> row(String label, ReportBillTotals t) => [
      label,
      '${t.count}',
      ReportPdfStyle.amount(t.grossAmount),
      ReportPdfStyle.amount(t.discountAmount),
      ReportPdfStyle.amount(t.taxableValue),
      ReportPdfStyle.amount(t.cgstAmount),
      ReportPdfStyle.amount(t.sgstAmount),
      ReportPdfStyle.amount(t.roundOff),
      ReportPdfStyle.amount(t.totalAmount),
    ];
    final docRows = <List<String>>[];
    for (final type in types) {
      final t = summary.byDocumentType[type];
      if (t == null || t.count == 0) continue;
      docRows.add(row(kDocumentTypeLabel[type] ?? type, t));
    }

    return ReportPdfStyle.table(
      columns: const [
        ReportPdfColumn('Document', flex: 1.8),
        ReportPdfColumn('Bills', flex: 0.8, align: pw.TextAlign.right),
        ReportPdfColumn('Gross', flex: 1.3, align: pw.TextAlign.right),
        ReportPdfColumn('Discount', flex: 1.1, align: pw.TextAlign.right),
        ReportPdfColumn('Taxable value', flex: 1.4, align: pw.TextAlign.right),
        ReportPdfColumn('CGST', flex: 1.1, align: pw.TextAlign.right),
        ReportPdfColumn('SGST', flex: 1.1, align: pw.TextAlign.right),
        ReportPdfColumn('Round off', flex: 1, align: pw.TextAlign.right),
        ReportPdfColumn('Billed total', flex: 1.4, align: pw.TextAlign.right),
      ],
      rows: docRows.isEmpty ? [['No bills issued', '0', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00']] : docRows,
      totals: docRows.length > 1 ? row('Total', bills) : null,
    );
  }

  // ── Section 3: the register ────────────────────────────────────────────
  //
  // Split into three tables — Final bills, Advance payments, Cancelled
  // settlements — mirroring the three-section Part 3 in
  // frontend/src/pages/lodge/bookingReportFile.js. This split is specific to
  // the PDF; the on-screen grid in bookings_report_panel.dart keeps the
  // single combined register (booking_register_rows.dart), same as the web
  // dashboard's live Bookings tab does.

  static const List<ReportPdfColumn> _finalBillColumns = [
    ReportPdfColumn('Bill no.', flex: 44),
    ReportPdfColumn('Type', flex: 32),
    ReportPdfColumn('Bill date', flex: 42),
    ReportPdfColumn('Guest', flex: 90),
    ReportPdfColumn('Rm', flex: 20),
    ReportPdfColumn('Check-in', flex: 42),
    ReportPdfColumn('Check-out', flex: 42),
    ReportPdfColumn('Nts', flex: 16, align: pw.TextAlign.right),
    ReportPdfColumn('Status', flex: 38),
    ReportPdfColumn('Discount', flex: 44, align: pw.TextAlign.right),
    ReportPdfColumn('Taxable', flex: 48, align: pw.TextAlign.right),
    ReportPdfColumn('CGST', flex: 45, align: pw.TextAlign.right),
    ReportPdfColumn('SGST', flex: 45, align: pw.TextAlign.right),
    ReportPdfColumn('R/off', flex: 30, align: pw.TextAlign.right),
    ReportPdfColumn('Billed', flex: 48, align: pw.TextAlign.right),
    ReportPdfColumn('Advance', flex: 46, align: pw.TextAlign.right),
    ReportPdfColumn('Balance', flex: 46, align: pw.TextAlign.right),
    ReportPdfColumn('Paid by', flex: 60),
  ];

  static const List<ReportPdfColumn> _advanceColumns = [
    ReportPdfColumn('Guest', flex: 160),
    ReportPdfColumn('Rm', flex: 30),
    ReportPdfColumn('Check-in', flex: 55),
    ReportPdfColumn('Check-out', flex: 55),
    ReportPdfColumn('Status', flex: 50),
    ReportPdfColumn('Advance', flex: 70, align: pw.TextAlign.right),
    ReportPdfColumn('Paid by', flex: 110),
  ];

  static const List<ReportPdfColumn> _cancelledColumns = [
    ReportPdfColumn('Guest', flex: 140),
    ReportPdfColumn('Rm', flex: 28),
    ReportPdfColumn('Check-in', flex: 50),
    ReportPdfColumn('Check-out', flex: 50),
    ReportPdfColumn('Cancel reason', flex: 180),
    ReportPdfColumn('Advance held', flex: 70, align: pw.TextAlign.right),
    ReportPdfColumn('Refunded', flex: 70, align: pw.TextAlign.right),
    ReportPdfColumn('Cancel chg.', flex: 80, align: pw.TextAlign.right),
  ];

  static List<pw.Widget> _registerSections(BookingsReport report) {
    final billed = report.bookings.where((b) => b.status != 'CANCELLED' && b.invoiceNumber != null).toList();
    final advanceOnly = report.bookings
        .where((b) => b.status != 'CANCELLED' && b.invoiceNumber == null && b.advanceAmount > 0)
        .toList();
    final cancelled = report.bookings.where((b) => b.status == 'CANCELLED').toList();

    return [
      // ---- 3A. Final bills --------------------------------------------
      ReportPdfStyle.subheading('A. Final bills - ${billed.length} ${billed.length == 1 ? 'bill' : 'bills'}'),
      ReportPdfStyle.note(
        'Every stay with a bill issued. Taxable + CGST + SGST + R/off = Billed. Advance is the advance held '
        'against the stay; Balance is what else was collected on the bill.',
      ),
      if (billed.isEmpty)
        pw.Padding(
          padding: const pw.EdgeInsets.only(bottom: 14),
          child: pw.Text('No bills issued for stays checking in this period.',
              style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted)),
        )
      else
        pw.Padding(padding: const pw.EdgeInsets.only(bottom: 14), child: _finalBillsTable(billed)),

      // ---- 3B. Advance payments ----------------------------------------
      ReportPdfStyle.subheading(
        'B. Advance payments - ${advanceOnly.length} ${advanceOnly.length == 1 ? 'stay' : 'stays'} not yet billed',
      ),
      ReportPdfStyle.note(
        'Stays holding an advance with no bill issued yet. Once billed, the stay moves up into Final bills and '
        "this advance shows in that row's Advance column instead.",
      ),
      if (advanceOnly.isEmpty)
        pw.Padding(
          padding: const pw.EdgeInsets.only(bottom: 14),
          child: pw.Text('No unbilled stays holding an advance.',
              style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted)),
        )
      else
        pw.Padding(padding: const pw.EdgeInsets.only(bottom: 14), child: _advancePaymentsTable(advanceOnly)),

      // ---- 3C. Cancelled settlements ------------------------------------
      ReportPdfStyle.subheading(
        'C. Cancelled settlements - ${cancelled.length} ${cancelled.length == 1 ? 'booking' : 'bookings'}',
      ),
      ReportPdfStyle.note(
        'Every cancelled booking that was checking in this period, and how the advance held on it was settled. '
        'Any cancellation charge kept is income in part 1; a refund is not.',
      ),
      if (cancelled.isEmpty)
        pw.Text('No cancelled bookings checking in this period.',
            style: pw.TextStyle(fontSize: 8, color: ReportPdfStyle.muted))
      else
        _cancelledSettlementsTable(cancelled),
    ];
  }

  static pw.Widget _finalBillsTable(List<ReportBooking> billed) {
    num nights = 0, discount = 0, taxable = 0, cgst = 0, sgst = 0, roundOff = 0, billedTotal = 0;
    num advance = 0, balance = 0;
    for (final b in billed) {
      nights += b.nights;
      discount += b.discountAmount ?? 0;
      taxable += b.taxableValue ?? 0;
      cgst += b.cgstAmount ?? 0;
      sgst += b.sgstAmount ?? 0;
      roundOff += b.roundOff ?? 0;
      billedTotal += b.billedAmount ?? 0;
      advance += b.advanceAmount;
      balance += b.balanceCollected ?? 0;
    }
    return ReportPdfStyle.table(
      columns: _finalBillColumns,
      fontSize: 7,
      rows: [
        for (final b in billed)
          [
            b.invoiceNumber ?? '—',
            kDocumentShort[b.documentType] ?? b.documentType ?? '—',
            ReportPdfStyle.dateOnly(b.invoiceDate),
            b.guestName ?? '',
            b.roomNumber ?? '',
            ReportPdfStyle.dateOnly(b.checkInDate),
            ReportPdfStyle.dateOnly(b.checkOutDate),
            '${b.nights}',
            kStatusShort[b.status] ?? b.status,
            ReportPdfStyle.amount(b.discountAmount),
            ReportPdfStyle.amount(b.taxableValue),
            ReportPdfStyle.amount(b.cgstAmount),
            ReportPdfStyle.amount(b.sgstAmount),
            ReportPdfStyle.amount(b.roundOff),
            ReportPdfStyle.amount(b.billedAmount),
            b.advanceAmount > 0 ? ReportPdfStyle.amount(b.advanceAmount) : '—',
            (b.balanceCollected ?? 0) > 0 ? ReportPdfStyle.amount(b.balanceCollected) : '—',
            paidByLabel(b).isEmpty ? '—' : paidByLabel(b),
          ],
      ],
      totals: [
        'Total', '', '', '', '', '', '', '$nights', '',
        ReportPdfStyle.amount(discount), ReportPdfStyle.amount(taxable), ReportPdfStyle.amount(cgst),
        ReportPdfStyle.amount(sgst), ReportPdfStyle.amount(roundOff), ReportPdfStyle.amount(billedTotal),
        ReportPdfStyle.amount(advance), ReportPdfStyle.amount(balance), '',
      ],
    );
  }

  static pw.Widget _advancePaymentsTable(List<ReportBooking> advanceOnly) {
    num advanceTotal = 0;
    for (final b in advanceOnly) {
      advanceTotal += b.advanceAmount;
    }
    return ReportPdfStyle.table(
      columns: _advanceColumns,
      fontSize: 7,
      rows: [
        for (final b in advanceOnly)
          [
            b.guestName ?? '',
            b.roomNumber ?? '',
            ReportPdfStyle.dateOnly(b.checkInDate),
            ReportPdfStyle.dateOnly(b.checkOutDate),
            kStatusShort[b.status] ?? b.status,
            ReportPdfStyle.amount(b.advanceAmount),
            b.advanceTenders.isEmpty
                ? '—'
                : (b.advanceTenders.length == 1
                    ? paymentModeLabel(b.advanceTenders[0].method)
                    : tendersLabel(b.advanceTenders, ReportPdfStyle.amount)),
          ],
      ],
      totals: ['Total', '', '', '', '', ReportPdfStyle.amount(advanceTotal), ''],
    );
  }

  static pw.Widget _cancelledSettlementsTable(List<ReportBooking> cancelled) {
    num held = 0, refunded = 0, charged = 0;
    for (final b in cancelled) {
      held += b.advanceAmount;
      refunded += b.refundAmount ?? 0;
      charged += b.cancellationCharge ?? 0;
    }
    return ReportPdfStyle.table(
      columns: _cancelledColumns,
      fontSize: 7,
      rows: [
        for (final b in cancelled)
          [
            b.guestName ?? '',
            b.roomNumber ?? '',
            ReportPdfStyle.dateOnly(b.checkInDate),
            ReportPdfStyle.dateOnly(b.checkOutDate),
            b.cancelReason ?? '—',
            b.advanceAmount > 0 ? ReportPdfStyle.amount(b.advanceAmount) : '—',
            (b.refundAmount ?? 0) > 0 ? ReportPdfStyle.amount(b.refundAmount) : '—',
            (b.cancellationCharge ?? 0) > 0 ? ReportPdfStyle.amount(b.cancellationCharge) : '—',
          ],
      ],
      totals: [
        'Total', '', '', '', '',
        ReportPdfStyle.amount(held), ReportPdfStyle.amount(refunded), ReportPdfStyle.amount(charged),
      ],
    );
  }
}
