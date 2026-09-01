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
