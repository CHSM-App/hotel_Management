import 'json.dart';

/// One person the AI read off the ID photos — POST /bookings/scan-id.
/// Fields the AI could not read confidently arrive blank, never guessed.
class ScannedGuest {
  final String name;
  final String? idProofType;
  final String idProofNumber;

  /// Which of the uploaded photos (0-based, in the order sent) show this
  /// person's card — the first becomes their ID photo on the form.
  final List<int> imageIndexes;

  /// True when staff must type or fix something on this row.
  final bool needsReview;

  const ScannedGuest({
    required this.name,
    this.idProofType,
    this.idProofNumber = '',
    this.imageIndexes = const [],
    this.needsReview = false,
  });

  factory ScannedGuest.fromJson(Map<String, dynamic> json) => ScannedGuest(
    name: json['name']?.toString() ?? '',
    idProofType: asStringOrNull(json['idProofType']),
    idProofNumber: json['idProofNumber']?.toString() ?? '',
    imageIndexes: [
      for (final i in (json['imageIndexes'] as List? ?? [])) asInt(i),
    ],
    needsReview: asBool(json['needsReview']),
  );
}
