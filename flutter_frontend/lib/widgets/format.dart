import 'package:intl/intl.dart';

/// Rupees as they read on a bill: Indian grouping, and no trailing .00 on the
/// whole numbers most rates are.
String formatPrice(num? amount) {
  final value = amount ?? 0;
  final whole = value == value.roundToDouble();
  final f = NumberFormat.currency(
    locale: 'en_IN',
    symbol: '₹',
    decimalDigits: whole ? 0 : 2,
  );
  return f.format(value);
}

/// 2026-09-01 → 1 Sept 2026.
String formatDate(DateTime? d) =>
    d == null ? '' : DateFormat('d MMM yyyy').format(d);

/// The same, from the ISO strings the API speaks.
String formatIsoDate(String? iso) {
  if (iso == null || iso.isEmpty) return '';
  final parsed = DateTime.tryParse(iso);
  return parsed == null ? iso : formatDate(parsed);
}

/// The head count as a document prints it: "3 (2 Adults, 1 Child)". The split
/// is only stated when the booking recorded children — a booking from before
/// the child count was kept reads 0 whether or not children came, and "0
/// children" would be a claim nobody checked — so otherwise it is the plain
/// number. Null when there is no head count at all.
String? formatHeadCount(int? numGuests, int? childCount) {
  if (numGuests == null || numGuests <= 0) return null;
  final children = childCount ?? 0;
  if (children <= 0 || children >= numGuests) return '$numGuests';
  final adults = numGuests - children;
  return '$numGuests ($adults ${adults == 1 ? 'Adult' : 'Adults'}, '
      '$children ${children == 1 ? 'Child' : 'Children'})';
}

/// "3 nights", "1 night".
String nightsLabel(int nights) => '$nights night${nights == 1 ? '' : 's'}';

/// The clock time an ISO timestamp fell at — "2:45 PM" — for a food tab's
/// "since" or "placed" line, which cares when, not what day.
String formatTimeOfDay(String? iso) {
  if (iso == null || iso.isEmpty) return '';
  final parsed = DateTime.tryParse(iso);
  return parsed == null ? '' : DateFormat('h:mm a').format(parsed.toLocal());
}

/// Short floor code for tight labels: "1" → "F1", "Ground"/"G" → "G",
/// anything else (already short, or non-numeric) passed through as-is.
String formatFloor(String? floor) {
  final f = (floor ?? '').trim();
  if (f.isEmpty) return '';
  if (RegExp(r'^\d+$').hasMatch(f)) return 'F$f';
  if (RegExp(r'^g(round)?(\s*floor)?$', caseSensitive: false).hasMatch(f)) {
    return 'G';
  }
  return f;
}

/// "raJESH kumar" → "Rajesh Kumar" — names are stored as typed, and the desk
/// doesn't reliably hit shift, so this is what actually makes the register
/// and tape chart read as capitalized rather than the on-screen keyboard's
/// capitalize-next-letter hint (which never touches the saved text).
String capitalizeWords(String? s) {
  final value = (s ?? '').trim();
  if (value.isEmpty) return value;
  return value
      .split(RegExp(r'\s+'))
      .map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1).toLowerCase())
      .join(' ');
}

/// When something actually happened, not just which night it was booked
/// against — "27 Aug, 4:10 pm" for an actual check-in or check-out instant,
/// the same precision `formatIsoDate` deliberately drops for a plain date.
String formatDateTime(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final parsed = DateTime.tryParse(iso)?.toLocal();
  if (parsed == null) return iso;
  return DateFormat('d MMM, h:mm a').format(parsed);
}
