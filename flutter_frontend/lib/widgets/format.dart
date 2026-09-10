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

/// "3 nights", "1 night".
String nightsLabel(int nights) => '$nights night${nights == 1 ? '' : 's'}';

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
