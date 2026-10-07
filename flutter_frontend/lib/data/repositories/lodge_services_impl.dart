import '../../domain/models/invoice.dart' show InHouseGuest;
import '../../domain/models/lodge_service.dart';
import '../../domain/repository/lodge_services_repo.dart';
import '../api/api_service.dart';

class LodgeServicesImpl implements LodgeServicesRepository {
  final ApiService api;

  LodgeServicesImpl(this.api);

  @override
  Future<List<LodgeService>> services({bool includeInactive = false}) => api.lodgeServices(includeInactive: includeInactive);

  @override
  Future<LodgeService> createService(Map<String, dynamic> body) => api.createLodgeService(body);

  @override
  Future<LodgeService> updateService(int id, Map<String, dynamic> body) => api.updateLodgeService(id, body);

  @override
  Future<List<ServiceUsage>> usages({String status = 'all'}) => api.serviceUsages(status: status);

  @override
  Future<ServiceUsage> startUsage(Map<String, dynamic> body) => api.startServiceUsage(body);

  @override
  Future<ServiceUsage> completeUsage(int id) => api.completeServiceUsage(id);

  @override
  Future<ServiceUsage> cancelUsage(int id) => api.cancelServiceUsage(id);

  @override
  Future<List<InHouseGuest>> inHouseGuests() => api.inHouseGuests();
}
