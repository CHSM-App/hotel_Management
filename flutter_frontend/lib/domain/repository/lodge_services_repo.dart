import '../models/invoice.dart' show InHouseGuest;
import '../models/lodge_service.dart';

/// Other services — mirrors ServicesPanel.jsx.
abstract class LodgeServicesRepository {
  Future<List<LodgeService>> services({bool includeInactive = false});

  Future<LodgeService> createService(Map<String, dynamic> body);

  Future<LodgeService> updateService(int id, Map<String, dynamic> body);

  Future<List<ServiceUsage>> usages({String status = 'all'});

  Future<ServiceUsage> startUsage(Map<String, dynamic> body);

  Future<ServiceUsage> completeUsage(int id);

  Future<ServiceUsage> cancelUsage(int id);

  Future<List<InHouseGuest>> inHouseGuests();
}
