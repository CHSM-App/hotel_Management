import 'dart:typed_data';

import 'bar.dart';
import 'invoice.dart';
import 'me.dart';

/// A thermal receipt as plain lines, independent of how it is drawn: the same
/// document becomes ESC/POS text for a printer, a bordered picture, or a narrow
/// PDF for the Windows driver.
sealed class RLine {
  const RLine();

  /// Every string this line prints, for deciding whether text mode can carry it.
  Iterable<String> get texts;
}

enum RSize { small, normal, big }

/// One line of text, wrapped to the width.
class RText extends RLine {
  final String text;
  final bool center;
  final bool bold;
  final RSize size;
  const RText(this.text, {this.center = true, this.bold = false, this.size = RSize.normal});

  @override
  Iterable<String> get texts => [text];
}

/// Label on the left, figure on the right.
class RRow extends RLine {
  final String left;
  final String right;
  final bool bold;
  final bool big;
  const RRow(this.left, this.right, {this.bold = false, this.big = false});

  @override
  Iterable<String> get texts => [left, right];
}

/// A product: its name on a line of its own (long names wrap), then
/// `qty x rate` and the amount.
class RItem extends RLine {
  final String name;
  final String? qtyRate;
  final String amount;
  const RItem(this.name, this.qtyRate, this.amount);

  @override
  Iterable<String> get texts => [name, qtyRate ?? '', amount];
}

/// The items as a four-column table: Item | Qty | Price | Total.
///
/// Drawn as a ruled grid in the boxed picture. Plain text has no room for four
/// columns on a narrow roll, so there it becomes the name-then-figures lines of
/// [RItem] (see [asLines]).
class RTable extends RLine {
  final List<String> headers;
  final List<List<String>> rows;
  const RTable(this.headers, this.rows);

  @override
  Iterable<String> get texts => [...headers, for (final r in rows) ...r];

  /// The same items as text-mode lines.
  List<RLine> asLines() => [
    const RRow('Item', 'Amount (Rs.)', bold: true),
    const RRule(),
    for (final r in rows)
      RItem(r[0], (r[1].isEmpty && r[2].isEmpty) ? null : '${r[1]} x ${r[2]}', r[3]),
    const RRule(),
  ];
}

/// A small indented remark, e.g. "incl. CGST Rs. 9.00".
class RNote extends RLine {
  final String text;
  const RNote(this.text);

  @override
  Iterable<String> get texts => [text];
}

/// A dividing line: dashed in plain text, a full-width rule between the blocks
/// of the boxed receipt.
class RRule extends RLine {
  final bool strong;
  const RRule({this.strong = false});

  @override
  Iterable<String> get texts => const [];
}

class RGap extends RLine {
  const RGap();

  @override
  Iterable<String> get texts => const [];
}

/// The property's logo, already shrunk and reduced to black and white (RGBA, 0
/// or 255) at the size it prints, in printer dots.
class ReceiptLogo {
  final int width;
  final int height;
  final Uint8List rgba;
  const ReceiptLogo(this.width, this.height, this.rgba);
}

class ReceiptDoc {
  final List<RLine> lines;

  /// Printed centred above the first line, when there is one.
  final ReceiptLogo? logo;
  const ReceiptDoc(this.lines, {this.logo});

  ReceiptDoc withLogo(ReceiptLogo? logo) => logo == null ? this : ReceiptDoc(lines, logo: logo);

  /// The lines with each table written out as text lines.
  List<RLine> get textLines => [for (final l in lines) ...(l is RTable ? l.asLines() : [l])];

  /// Whether plain ESC/POS text can print every character. When not (Marathi
  /// names, say) the receipt goes as an image instead.
  bool get isAscii => lines.every((l) => l.texts.every((t) => t.codeUnits.every((c) => c >= 32 && c < 127)));
}

/// The receipts themselves — the same figures as the A4/A5/A6 documents,
/// nothing recomputed.
class ReceiptDocs {
  ReceiptDocs._();

  static const _pay = {'CASH': 'Cash', 'UPI': 'UPI', 'CARD': 'Card'};

  static const _tableHeaders = ['Item', 'Qty', 'Price', 'Total'];

  static String _rs(num v) => 'Rs. ${v.toStringAsFixed(2)}';

  /// A figure without the currency, for the table columns.
  static String _n(num v) => v.toStringAsFixed(2);

  static String _qty(num q) => q == q.roundToDouble() ? q.toInt().toString() : q.toString();

  static String _two(int v) => v.toString().padLeft(2, '0');

  /// 21-Nov-2026 01:41 PM — or just the date when the time is unknown.
  static String _stamp(String? iso) {
    final d = DateTime.tryParse(iso ?? '')?.toLocal();
    if (d == null) return (iso ?? '').split('T').first;
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final date = '${_two(d.day)}-${m[d.month - 1]}-${d.year}';
    if (!(iso ?? '').contains('T')) return date;
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    return '$date ${_two(h)}:${_two(d.minute)} ${d.hour >= 12 ? 'PM' : 'AM'}';
  }

  /// The masthead: name, address, phone, GSTIN — whichever the property has.
  static List<RLine> _header(String name, {String? address, String? phone, String? gstin}) => [
    RText(name, bold: true, size: RSize.big),
    if ((address ?? '').trim().isNotEmpty) RText(address!.trim()),
    if ((phone ?? '').trim().isNotEmpty) RText('Ph: ${phone!.trim()}'),
    if ((gstin ?? '').trim().isNotEmpty) RText('GSTIN: ${gstin!.trim()}'),
  ];

  static String _join(Iterable<String?> parts) => parts.whereType<String>().where((s) => s.trim().isNotEmpty).join(', ');

  /// One `Payment:` row per tender — the method alone when it paid the lot.
  static List<RLine> _payments(Iterable<({String method, num amount, String? reference})> list, num total) {
    final all = list.toList();
    return [
      for (final p in all)
        RRow(
          'Payment:',
          (all.length == 1 && (p.amount - total).abs() < 0.005
                  ? (_pay[p.method] ?? p.method).toUpperCase()
                  : '${_pay[p.method] ?? p.method} ${_rs(p.amount)}') +
              ((p.reference ?? '').isEmpty ? '' : ' (${p.reference})'),
        ),
    ];
  }

  static const _footer = <RLine>[
    RRule(),
    RText('Thank you, visit again!', bold: true),
    RText('Powered by Vengurla Tech', size: RSize.small),
  ];

  static ReceiptDoc bar(BarBill b, {required String lodgeName, Lodge? lodge}) {
    final lines = [...b.items, ...b.foodItems];
    final both = b.drinksSubtotal > 0 && b.foodSubtotal > 0;
    final subtotal = b.subtotal > 0 ? b.subtotal : b.total;
    return ReceiptDoc([
      ..._header(
        lodgeName,
        address: _join([lodge?.address, lodge?.city]),
        phone: lodge?.phone,
        gstin: (lodge?.isGstRegistered ?? false) ? lodge?.gstin : null,
      ),
      const RRule(),
      const RText('BAR BILL', bold: true),
      RText('Bill#: ${b.billNumber}', center: false),
      RText('Date: ${_stamp(b.createdAt ?? b.billDate)}', center: false),
      if ((b.customerName ?? '').isNotEmpty) RText('Customer: ${b.customerName}', center: false),
      const RRule(),
      RTable(_tableHeaders, [
        for (final l in lines)
          ['${l.name}${l.size.isEmpty ? '' : ' (${l.size})'}', '${l.quantity}', _n(l.unitPrice), _n(l.lineTotal)],
      ]),
      if (both) ...[
        RRow('Drinks:', _rs(b.drinksSubtotal)),
        if (b.taxAmount > 0) RNote('incl. ${b.taxPercent.toStringAsFixed(0)}% tax ${_rs(b.taxAmount)}'),
        RRow('Food:', _rs(b.foodSubtotal)),
        if (b.foodTaxAmount > 0) RNote('incl. GST ${_rs(b.foodTaxAmount)}'),
      ] else ...[
        RRow('Subtotal:', _rs(subtotal)),
        if (b.drinksSubtotal > 0 && b.taxAmount > 0) RNote('incl. ${b.taxPercent.toStringAsFixed(0)}% tax ${_rs(b.taxAmount)}'),
        if (b.foodSubtotal > 0 && b.foodTaxAmount > 0) RNote('incl. GST ${_rs(b.foodTaxAmount)}'),
      ],
      RRow('TOTAL:', _rs(b.total), bold: true, big: true),
      ..._payments([for (final p in b.payments) (method: p.method, amount: p.amount, reference: p.reference)], b.total),
      ..._footer,
    ]);
  }

  static ReceiptDoc invoice(Invoice inv, {required String lodgeName}) {
    final isFood = inv.kind == 'FOOD';
    final label = isFood ? 'Restaurant bill' : (kDocumentLabels[inv.documentType] ?? 'Bill');
    final cgst = inv.cgstAmount + inv.foodCgstAmount + inv.serviceCgstAmount;
    final sgst = inv.sgstAmount + inv.foodSgstAmount + inv.serviceSgstAmount;
    final who = [
      if ((inv.tableLabel ?? '').isNotEmpty) 'Table ${inv.tableLabel}',
      if ((inv.roomNumber ?? '').isNotEmpty) 'Room ${inv.roomNumber}',
    ].join(', ');
    final rows = <List<String>>[
      for (final l in inv.roomCharges) [l.label, l.nights > 0 ? '${l.nights}' : '', '', _n(l.amount)],
      for (final f in inv.foodItems) [f.name, _qty(f.quantity), _n(f.unitPrice), _n(f.lineTotal)],
      for (final s in inv.serviceItems) [s.name, _qty(s.quantity), _n(s.unitPrice), _n(s.lineTotal)],
      if (inv.lateCheckoutCharge > 0) ['Late check-out', '', '', _n(inv.lateCheckoutCharge)],
    ];
    return ReceiptDoc([
      ..._header(
        inv.lodgeName ?? lodgeName,
        address: inv.lodgeAddress,
        phone: inv.lodgePhone,
        gstin: inv.isGstRegistered ? inv.gstin : null,
      ),
      const RRule(),
      RText(label.toUpperCase(), bold: true),
      if (inv.status == 'VOID') const RText('*** VOID ***', bold: true),
      RText('Bill#: ${inv.invoiceNumber ?? inv.id}', center: false),
      RText('Date: ${_stamp(inv.createdAt)}', center: false),
      if (who.isNotEmpty) RText('For: $who', center: false),
      if ((inv.guestName ?? '').isNotEmpty) RText('Guest: ${inv.guestName}', center: false),
      const RRule(),
      RTable(_tableHeaders, rows),
      if (inv.discountAmount > 0) RRow('Discount:', '- ${_rs(inv.discountAmount)}'),
      if (inv.roundOff != 0) RRow('Round off:', _rs(inv.roundOff)),
      if (inv.isGstRegistered && (cgst > 0 || sgst > 0)) ...[
        RNote('incl. CGST ${_rs(cgst)}'),
        RNote('incl. SGST ${_rs(sgst)}'),
      ],
      RRow('TOTAL:', _rs(inv.totalAmount), bold: true, big: true),
      if (inv.advancePaid > 0) RRow('Advance paid:', _rs(inv.advancePaid)),
      ..._payments([for (final p in inv.paymentLines) (method: p.method, amount: p.amount, reference: p.reference)], inv.totalAmount),
      ..._footer,
    ]);
  }

  /// A short slip with a bill's shape — a long wrapped name, a total — so a
  /// good test print means bills will print too.
  static ReceiptDoc test({required String lodgeName, required String paper}) => ReceiptDoc([
    RText(lodgeName, bold: true, size: RSize.big),
    const RText('Printer test'),
    const RRule(),
    RText('Paper: $paper', center: false),
    const RText('Date: 21-Nov-2026 01:41 PM', center: false),
    const RRule(),
    RTable(_tableHeaders, [
      ['Sample item with a long name that wraps onto a second line', '2', _n(125), _n(250)],
      ['Second item', '1', _n(40), _n(40)],
    ]),
    RRow('Subtotal:', _rs(290)),
    RRow('TOTAL:', _rs(290), bold: true, big: true),
    const RRow('Payment:', 'CASH'),
    ..._footer,
  ]);
}
