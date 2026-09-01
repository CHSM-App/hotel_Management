/// Reading numbers off this API without assuming what type they arrived as.
library;
///
/// The backend is on SQL Server through tedious, which returns BIGINT columns
/// as **strings** — a bigint does not fit a JavaScript number, so the driver
/// refuses to narrow it and hands back text instead. Every other numeric type
/// (INT, DECIMAL) comes back as a number.
///
/// The result is an API where `{"id": "46", "numGuests": 2, "totalPrice": 1800}`
/// is normal and correct: the id is a BIGINT, the count is an INT, the money is
/// a DECIMAL. A cast like `json['id'] as num` is therefore right for two of
/// those three and throws on the first — and it throws *after* a successful
/// request, so it surfaces as "something went wrong" on a call that actually
/// worked. That is precisely how the login failed against a 200 response.
///
/// So nothing here casts. Everything numeric goes through these.

int? asIntOrNull(dynamic value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value.toString());
}

/// For a field the server always sends. Falls back rather than throwing: a
/// missing id is worth rendering as 0 and noticing on screen, not worth taking
/// the whole list down for.
int asInt(dynamic value, {int fallback = 0}) =>
    asIntOrNull(value) ?? fallback;

num? asNumOrNull(dynamic value) {
  if (value == null) return null;
  if (value is num) return value;
  return num.tryParse(value.toString());
}

num asNum(dynamic value, {num fallback = 0}) =>
    asNumOrNull(value) ?? fallback;

/// Booleans arrive as real booleans from this API (`!!row.has_rooms`), but a
/// 0/1 from a driver that did not coerce would otherwise read as false-y
/// nonsense, so both are accepted.
bool asBool(dynamic value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) return value == 'true' || value == '1';
  return false;
}

/// Ids and phone numbers are sometimes strings and sometimes numbers depending
/// on the column; either way the screen wants text.
String? asStringOrNull(dynamic value) {
  if (value == null) return null;
  final s = value.toString();
  return s.isEmpty ? null : s;
}
