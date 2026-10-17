import '../models/laundry.dart';
import '../repository/laundry_repo.dart';

class LaundryUsecase {
  final LaundryRepository repository;

  LaundryUsecase(this.repository);

  Future<LinenBoard> linenBoard() => repository.linenBoard();

  Future<void> createLinenItem(Map<String, dynamic> body) => repository.createLinenItem(body);

  Future<void> updateLinenItem(int id, Map<String, dynamic> body) => repository.updateLinenItem(id, body);

  Future<void> receiveHandovers(List<int> movementIds) => repository.receiveHandovers(movementIds);

  Future<void> sendToLaundry(Map<String, dynamic> body) => repository.sendToLaundry(body);

  Future<void> receiveFromLaundry(Map<String, dynamic> body) => repository.receiveFromLaundry(body);

  Future<void> recordLoss(Map<String, dynamic> body) => repository.recordLoss(body);

  Future<List<RecentGarment>> recentGarments() => repository.recentGarments();

  Future<List<LaundryGuestStay>> inHouseGuests() => repository.inHouseGuests();

  Future<List<LaundryOrder>> laundryOrders({String scope = 'all'}) => repository.laundryOrders(scope: scope);

  Future<LaundryOrder> createLaundryOrder(Map<String, dynamic> body) => repository.createLaundryOrder(body);

  Future<LaundryOrder> setLaundryStatus(int id, Map<String, dynamic> body) => repository.setLaundryStatus(id, body);
}
