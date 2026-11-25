import 'package:url_launcher/url_launcher.dart';

import '../../domain/models/saved_quotation.dart';
import '../../widgets/format.dart';

// ── The WhatsApp message for a quotation ─────────────────────────────────
//
// Edit the wording here. {placeholders} are filled by [quotationWhatsAppMessage];
// a line whose value is empty (no note, no validity date…) is dropped, so the
// message never carries a blank label.
//
//   {name}      guest name, or "Sir/Madam" when none was typed
//   {hotel}     the property's name
//   {kind}      room / event / restaurant / bar
//   {ref}       the QTN- reference code
//   {details}   the kind's own lines (rooms and dates, venue and date, items)
//   {total}     the quoted total
//   {valid}     the day the quotation stops being valid
//   {note}      the note typed on the quotation
//   {link}      the quotation PDF link ("View your quotation: …"); left out if it could not be made
//   {contact}   the property's phone number
const kQuotationWhatsAppTemplate = '''Dear {name},

Thank you for your enquiry with {hotel}. Here is your {kind} quotation.

Quotation No: {ref}
{details}
*Total: {total}*
{valid}
{note}
{link}

This is a quotation, not a bill. To confirm, just reply to this message{contact}.

Warm regards,
Reservations Team''';

String _day(String? iso) => formatDate(DateTime.tryParse(iso ?? ''));

num _n(dynamic v) => v is num ? v : num.tryParse('$v') ?? 0;

/// The kind's own lines: what was quoted, in a few readable rows.
String _details(SavedQuotation q) {
  final d = q.details;
  switch (q.kind) {
    case 'ROOM':
      return [
        for (final r in q.rooms)
          '• Room ${r.roomNumber}${r.categoryName.isEmpty ? '' : ' (${r.categoryName})'}: '
              '${_day(r.fromDate)} to ${_day(r.toDate)}, ${r.result.nightCount} night${r.result.nightCount == 1 ? '' : 's'} – ${formatPrice(r.result.total)}',
      ].join('\n');
    case 'EVENT':
      final input = Map<String, dynamic>.from((d['input'] as Map?) ?? const {});
      final pricing = Map<String, dynamic>.from((d['pricing'] as Map?) ?? const {});
      final start = DateTime.tryParse('${input['startAt']}')?.toLocal();
      return [
        'Venue: ${d['venueName'] ?? ''}',
        if (start != null) 'Date: ${formatDate(start)}, ${formatTimeOfDay(start.toIso8601String())}',
        'Guests: ${_n(pricing['billablePax']).toInt()}',
      ].join('\n');
    default:
      return [
        for (final l in (d['lines'] as List? ?? const []))
          '• ${(l as Map)['itemName']} × ${_n(l['quantity']).toInt()} – ${formatPrice(_n(l['lineTotal']))}',
      ].join('\n');
  }
}

String quotationWhatsAppMessage(SavedQuotation q, {required String hotel, String? hotelPhone, String? link}) {
  final kind = switch (q.kind) {
    'EVENT' => 'event',
    'FOOD' => 'restaurant',
    'BAR' => 'bar',
    _ => 'room',
  };
  final note = q.details['note']?.toString() ?? '';
  final valid = q.validUntil == null || q.validUntil!.isEmpty
      ? ''
      : 'Valid until: ${_day(q.validUntil)}';
  final text = kQuotationWhatsAppTemplate
      .replaceAll('{name}', (q.guestName ?? '').trim().isEmpty ? 'Sir/Madam' : q.guestName!.trim())
      .replaceAll('{hotel}', hotel.isEmpty ? 'us' : hotel)
      .replaceAll('{kind}', kind)
      .replaceAll('{ref}', q.referenceCode)
      .replaceAll('{details}', _details(q))
      .replaceAll('{total}', formatPrice(q.total))
      .replaceAll('{valid}', valid)
      .replaceAll('{note}', note.isEmpty ? '' : 'Note: $note')
      .replaceAll('{link}', (link ?? '').isEmpty ? '' : 'View your quotation: $link')
      .replaceAll('{contact}', (hotelPhone ?? '').isEmpty ? '' : ' or call $hotelPhone');
  // A placeholder that came out empty leaves its line blank; squeeze those.
  return text.replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
}

/// 10-digit numbers get the country code; anything else is passed through as
/// digits rather than guessed at — a wrong country code messages a stranger.
String _waDigits(String raw) {
  final digits = raw.replaceAll(RegExp(r'\D'), '');
  if (digits.length == 10) return '91$digits';
  if (digits.length == 11 && digits.startsWith('0')) return '91${digits.substring(1)}';
  return digits;
}

/// Opens WhatsApp with the message ready to send. With no guest number it
/// opens WhatsApp's own contact chooser instead. Returns false if it could
/// not be opened.
Future<bool> openQuotationOnWhatsApp(SavedQuotation q, {required String hotel, String? hotelPhone, String? link}) {
  final digits = _waDigits(q.guestPhone ?? '');
  final text = quotationWhatsAppMessage(q, hotel: hotel, hotelPhone: hotelPhone, link: link);
  final uri = Uri.https('wa.me', digits.isEmpty ? '' : '/$digits', {'text': text});
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}
