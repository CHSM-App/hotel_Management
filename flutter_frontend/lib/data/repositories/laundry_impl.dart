import '../../domain/models/laundry.dart';
import '../../domain/repository/laundry_repo.dart';
import '../api/api_service.dart';

class LaundryImpl implements LaundryRepository {
  final ApiService api;

  LaundryImpl(this.api);

  @override
  Future<LinenBoard> linenBoard() => api.linenBoard();

  @override
  Future<void> createLinenItem(Map<String, dynamic> body) => api.createLinenItem(body);

  @override
  Future<void> updateLinenItem(int id, Map<String, dynamic> body) => api.updateLinenItem(id, body);

  @override
  Future<void> receiveHandovers(List<int> movementIds) => api.receiveLinenHandovers(movementIds);

  @override
  Future<void> sendToLaundry(Map<String, dynamic> body) => api.sendToLaundry(body);

  @override
  Future<void> receiveFromLaundry(Map<String, dynamic> body) => api.receiveFromLaundry(body);

  @override
  Future<void> recordLoss(Map<String, dynamic> body) => api.recordLinenLoss(body);

  @override
  Future<List<RecentGarment>> recentGarments() => api.recentGarments();

  @override
  Future<List<LaundryGuestStay>> inHouseGuests() => api.laundryInHouseGuests();

  @override
  Future<List<LaundryOrder>> laundryOrders({String scope = 'all'}) => api.laundryOrders(scope: scope);

  @override
  Future<LaundryOrder> createLaundryOrder(Map<String, dynamic> body) => api.createLaundryOrder(body);

  @override
  Future<LaundryOrder> setLaundryStatus(int id, Map<String, dynamic> body) => api.setLaundryStatus(id, body);
}
