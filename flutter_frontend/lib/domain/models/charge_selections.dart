import 'draft.dart';

/// Pure helpers over a room's `chargeId -> ExtraDraft` selections — shared by
/// room 1 (still [BookingState.extras]) and every [ExtraRoomDraft], so the
/// two never drift into two slightly different serializations of the same
/// thing. Mirrors the web's chargeSelections.js one-for-one.
class ChargeSelections {
  const ChargeSelections._();

  /// How many extras are switched on.
  static int selectionCount(Map<int, ExtraDraft> extras) => extras.length;

  /// What was agreed for one extra's line, per night — null means "charge
  /// the lodge's own rate", the same convention [selectionOf] and
  /// [chargesPayload] use.
  static num? selectionAgreed(
    Map<int, ExtraDraft> extras,
    int chargeId,
    int nights,
  ) {
    final draft = extras[chargeId];
    if (draft == null) return null;
    final total = num.tryParse(draft.agreedTotal.trim());
    if (total == null || total <= 0) return null;
    final per = nights <= 0 ? 1 : nights;
    return (total / per * 100).round() / 100;
  }

  /// Numeric-safe id compare — kept for parity with the web module, where an
  /// id could arrive as a string from one endpoint and a number from
  /// another; every id here is already normalized to `int` at the model
  /// boundary (see json.dart's asInt/asIntOrNull), so this is plain equality.
  static bool sameCharge(int a, int b) => a == b;

  static Map<int, ExtraDraft> toggleSelection(
    Map<int, ExtraDraft> extras,
    int chargeId,
    bool on,
  ) {
    final next = Map<int, ExtraDraft>.from(extras);
    if (on) {
      next[chargeId] = ExtraDraft();
    } else {
      next.remove(chargeId);
    }
    return next;
  }

  static Map<int, ExtraDraft> withQuantity(
    Map<int, ExtraDraft> extras,
    int chargeId,
    int quantity,
  ) {
    if (quantity <= 0) return toggleSelection(extras, chargeId, false);
    final next = Map<int, ExtraDraft>.from(extras);
    final current = next[chargeId] ?? ExtraDraft();
    next[chargeId] = ExtraDraft(
      quantity: quantity,
      agreedTotal: current.agreedTotal,
    );
    return next;
  }

  static Map<int, ExtraDraft> withAgreedAmount(
    Map<int, ExtraDraft> extras,
    int chargeId,
    String agreedTotal,
  ) {
    final next = Map<int, ExtraDraft>.from(extras);
    final current = next[chargeId] ?? ExtraDraft();
    next[chargeId] = ExtraDraft(
      quantity: current.quantity,
      agreedTotal: agreedTotal,
    );
    return next;
  }

  static ExtraDraft? selectionOf(Map<int, ExtraDraft> extras, int chargeId) =>
      extras[chargeId];

  /// The wire format the pricing engine's query string parses:
  /// `id:quantity@agreedRate`, comma separated, rate omitted when nothing was
  /// agreed. Null when there is nothing selected at all, matching
  /// [BookingViewModel.chargeIdsParam]'s existing "omit the query param
  /// entirely" convention.
  static String? chargesParam(Map<int, ExtraDraft> extras, int nights) {
    if (extras.isEmpty) return null;
    final parts = extras.entries.map((e) {
      final agreed = selectionAgreed(extras, e.key, nights);
      final spec = '${e.key}:${e.value.quantity}';
      return agreed == null ? spec : '$spec@$agreed';
    });
    return parts.join(',');
  }

  /// The JSON-array shape `[{id, quantity, agreedAmount?}]` sent on save —
  /// same shape `BookingViewModel._extrasJson()` already builds for room 1.
  static List<Map<String, dynamic>> chargesPayload(
    Map<int, ExtraDraft> extras,
    int nights,
  ) => [
    for (final e in extras.entries)
      {
        'id': e.key,
        'quantity': e.value.quantity,
        if (selectionAgreed(extras, e.key, nights) != null)
          'agreedAmount': selectionAgreed(extras, e.key, nights),
      },
  ];
}
