import 'draft.dart';
import 'room.dart' show SwitchableCharge;

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
  /// [chargesPayload] use. A typed `0` is a deliberate "free", not "no
  /// override" — only a blank or negative box falls back to the lodge's rate.
  static num? selectionAgreed(
    Map<int, ExtraDraft> extras,
    int chargeId,
    int nights,
  ) {
    final draft = extras[chargeId];
    if (draft == null) return null;
    final total = num.tryParse(draft.agreedTotal.trim());
    if (total == null || total < 0) return null;
    final per = nights <= 0 ? 1 : nights;
    return (total / per * 100).round() / 100;
  }

  /// Numeric-safe id compare — kept for parity with the web module, where an
  /// id could arrive as a string from one endpoint and a number from
  /// another; every id here is already normalized to `int` at the model
  /// boundary (see json.dart's asInt/asIntOrNull), so this is plain equality.
  static bool sameCharge(int a, int b) => a == b;

  /// An extra with a hiddenWhenChargeId is hidden while that other extra is
  /// ticked (Extra Person Non AC disappears once AC is ticked); unticking
  /// brings it back.
  static bool isHiddenExtra(
    Map<int, ExtraDraft> extras,
    SwitchableCharge charge,
  ) =>
      charge.hiddenWhenChargeId != null &&
      extras.containsKey(charge.hiddenWhenChargeId);

  /// [charges] is optional: pass the list the form renders and any extra the
  /// new tick has just hidden is dropped, so a hidden extra is never still
  /// booked.
  static Map<int, ExtraDraft> toggleSelection(
    Map<int, ExtraDraft> extras,
    int chargeId,
    bool on, [
    List<SwitchableCharge> charges = const [],
  ]) {
    final next = Map<int, ExtraDraft>.from(extras);
    if (on) {
      next[chargeId] = ExtraDraft();
    } else {
      next.remove(chargeId);
    }
    for (final charge in charges) {
      if (next.containsKey(charge.id) && isHiddenExtra(next, charge)) {
        next.remove(charge.id);
      }
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
      agreedTotalTouched: current.agreedTotalTouched,
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
      agreedTotalTouched: true,
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
