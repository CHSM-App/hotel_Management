import '../models/laundry.dart';

/// Laundry — hotel linen and guest laundry. Mirrors LaundryPanel.jsx.
abstract class LaundryRepository {
  Future<LinenBoard> linenBoard();

  Future<void> createLinenItem(Map<String, dynamic> body);

  Future<void> updateLinenItem(int id, Map<String, dynamic> body);

  Future<void> receiveHandovers(List<int> movementIds);

  Future<void> sendToLaundry(Map<String, dynamic> body);

  Future<void> receiveFromLaundry(Map<String, dynamic> body);

  Future<void> recordLoss(Map<String, dynamic> body);

  Future<List<RecentGarment>> recentGarments();

  Future<List<LaundryGuestStay>> inHouseGuests();

  Future<List<LaundryOrder>> laundryOrders({String scope = 'all'});

  Future<LaundryOrder> createLaundryOrder(Map<String, dynamic> body);

  Future<LaundryOrder> setLaundryStatus(int id, Map<String, dynamic> body);
}
