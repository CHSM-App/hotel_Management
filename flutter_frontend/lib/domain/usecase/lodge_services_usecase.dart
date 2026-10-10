import '../models/invoice.dart' show InHouseGuest;
import '../models/lodge_service.dart';
import '../repository/lodge_services_repo.dart';

class LodgeServicesUsecase {
  final LodgeServicesRepository repository;

  LodgeServicesUsecase(this.repository);

  Future<List<LodgeService>> services({bool includeInactive = false}) => repository.services(includeInactive: includeInactive);

  Future<LodgeService> createService(dynamic body) => repository.createService(body);

  Future<LodgeService> updateService(int id, dynamic body) => repository.updateService(id, body);

  Future<List<ServiceUsage>> usages({String status = 'all'}) => repository.usages(status: status);

  Future<ServiceUsage> startUsage(Map<String, dynamic> body) => repository.startUsage(body);

  Future<ServiceUsage> completeUsage(int id) => repository.completeUsage(id);

  Future<ServiceUsage> cancelUsage(int id) => repository.cancelUsage(id);

  Future<List<InHouseGuest>> inHouseGuests() => repository.inHouseGuests();
}
