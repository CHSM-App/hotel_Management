import '../../domain/models/room.dart';
import '../../domain/pricing/bill_pricing.dart';
import '../../domain/pricing/late_checkout_calc.dart';
import '../../domain/pricing/stay_pricing.dart';

/// What the device downloaded (GET /sync/bootstrap) to keep running with no
/// network: every room and what it costs, the seasons and GST slabs that price
/// a stay and its bill, the property's check-out policy, and the room chart for
/// the coming weeks. Held as parsed objects for the engine, with the raw rooms
/// kept alongside because the booking screens read `Room`s straight from it.
class ReferenceData {
  final String fetchedAt;
  final String today;
  final List<Map<String, dynamic>> roomsJson;
  final List<PricingSeason> seasons;
  final List<BillSlab> slabs;
  final FoodRate? foodRate;
  final bool isGstRegistered;
  final bool isSpecifiedPremises;
  final String? gstin;
  final String checkinMode;
  final String checkInTime;
  final String checkOutTime;
  final String? earlyArrivalFrom;
  final LatePolicy policy;
  final Map<String, dynamic> chart;

  const ReferenceData({
    required this.fetchedAt,
    required this.today,
    required this.roomsJson,
    required this.seasons,
    required this.slabs,
    required this.foodRate,
    required this.isGstRegistered,
    required this.isSpecifiedPremises,
    required this.gstin,
    required this.checkinMode,
    required this.checkInTime,
    required this.checkOutTime,
    required this.earlyArrivalFrom,
    required this.policy,
    required this.chart,
  });

  List<Room> get rooms => [for (final r in roomsJson) Room.fromJson(r)];

  Map<String, dynamic>? roomJson(int id) {
    for (final r in roomsJson) {
      if (int.tryParse('${r['id']}') == id) return r;
    }
    return null;
  }

  List<PricingCharge> chargesOf(Map<String, dynamic> room) => [
    for (final c in (room['switchableCharges'] as List? ?? const []))
      PricingCharge.fromJson(c as Map<String, dynamic>),
  ];

  factory ReferenceData.fromJson(Map<String, dynamic> j, {String? fetchedAt}) {
    final lodge = (j['lodge'] as Map?)?.cast<String, dynamic>() ?? const {};
    final specified = lodge['isSpecifiedPremises'] == true;

    final slabRows = [
      for (final s in (j['gstSlabs'] as List? ?? const [])) (s as Map).cast<String, dynamic>(),
    ];
    final accommodation = [
      for (final s in slabRows)
        if (s['supplyType'] == 'ACCOMMODATION') BillSlab.fromJson(s),
    ];

    // Food is one flat rate chosen by the premises: the row that names this
    // property's kind, else the one that applies either way.
    FoodRate? food;
    final foodRows = slabRows.where((s) => s['supplyType'] == 'FOOD').toList();
    for (final s in foodRows) {
      if (s['appliesToSpecified'] == specified) {
        food = FoodRate(s['ratePercent'] as num, s['sacCode'] as String?);
        break;
      }
    }
    if (food == null) {
      for (final s in foodRows) {
        if (s['appliesToSpecified'] == null) {
          food = FoodRate(s['ratePercent'] as num, s['sacCode'] as String?);
          break;
        }
      }
    }

    return ReferenceData(
      fetchedAt: fetchedAt ?? DateTime.now().toIso8601String(),
      today: j['today'] as String? ?? DateTime.now().toIso8601String().substring(0, 10),
      roomsJson: [for (final r in (j['rooms'] as List? ?? const [])) (r as Map).cast<String, dynamic>()],
      seasons: [
        for (final s in (j['seasons'] as List? ?? const []))
          if ((s as Map)['isActive'] != false) PricingSeason.fromJson(s.cast<String, dynamic>()),
      ],
      slabs: accommodation,
      foodRate: food,
      isGstRegistered: lodge['isGstRegistered'] == true,
      isSpecifiedPremises: specified,
      gstin: lodge['gstin'] as String?,
      checkinMode: lodge['checkinMode'] as String? ?? 'NIGHT_BASED',
      checkInTime: lodge['checkInTime'] as String? ?? '12:00:00',
      checkOutTime: lodge['checkOutTime'] as String? ?? '11:00:00',
      earlyArrivalFrom: lodge['earlyArrivalFrom'] as String?,
      policy: LatePolicy(
        lateGraceMinutes: (lodge['lateGraceMinutes'] as num?)?.toInt() ?? 0,
        lateHalfDayPercent: (lodge['lateHalfDayPercent'] as num?) ?? 50,
        lateFullDayAfterMinutes: (lodge['lateFullDayAfterMinutes'] as num?)?.toInt() ?? 360,
        lateFullDayPercent: (lodge['lateFullDayPercent'] as num?) ?? 100,
      ),
      chart: (j['tapeChart'] as Map?)?.cast<String, dynamic>() ?? const {},
    );
  }
}
