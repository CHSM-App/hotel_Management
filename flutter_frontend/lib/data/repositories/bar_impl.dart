import '../../domain/models/bar.dart';
import '../../domain/models/menu.dart';
import '../../domain/repository/bar_repo.dart';
import '../api/api_service.dart';

/// Remote only: live queues must say what is true now, and writes need the server.
class BarImpl implements BarRepository {
  final ApiService api;

  BarImpl(this.api);

  @override
  Future<BarMenu> menu() => api.barMenu();

  @override
  Future<BarSettings> updateSettings(Map<String, dynamic> body) => api.updateBarSettings(body);

  @override
  Future<void> saveCategory(int? id, Map<String, dynamic> body) => api.saveBarCategory(id, body);

  @override
  Future<void> deleteCategory(int id) => api.deleteBarCategory(id);

  @override
  Future<void> createProduct(Map<String, dynamic> body) => api.createBarProduct(body);

  @override
  Future<void> updateProduct(int id, Map<String, dynamic> body) => api.updateBarProduct(id, body);

  @override
  Future<void> addSize(int productId, Map<String, dynamic> body) => api.addBarSize(productId, body);

  @override
  Future<void> updateSize(int sizeId, Map<String, dynamic> body) => api.updateBarSize(sizeId, body);

  @override
  Future<void> adjustStock(int productId, Map<String, dynamic> body) => api.adjustBarStock(productId, body);

  @override
  Future<List<BarMovement>> movements(int productId) => api.barMovements(productId);

  @override
  Future<List<BarOrder>> orders() => api.barOrders();

  @override
  Future<List<BarOrder>> history(String from, String to) => api.barHistory(from, to);

  @override
  Future<BarTargets> targets() => api.barTargets();

  @override
  Future<List<MenuSection>> foodMenu() => api.barFoodMenu();

  @override
  Future<int> createOrder(Map<String, dynamic> body) => api.createBarOrder(body);

  @override
  Future<void> addItems(int id, Map<String, dynamic> body) => api.addBarOrderItems(id, body);

  @override
  Future<void> setItemQty(int id, int itemId, int quantity) => api.setBarItemQty(id, itemId, quantity);

  @override
  Future<void> cancelItem(int id, int itemId) => api.cancelBarItem(id, itemId);

  @override
  Future<void> cancelOrder(int id) => api.cancelBarOrder(id);

  @override
  Future<void> deliverOrder(int id) => api.deliverBarOrder(id);

  @override
  Future<void> deliverItem(int id, int itemId) => api.deliverBarItem(id, itemId);

  @override
  Future<void> deliverFoodItem(int foodOrderId, int itemId) => api.deliverBarFoodItem(foodOrderId, itemId);

  @override
  Future<void> setCustomer(int id, String? tag) => api.barSetCustomer(id, tag);

  @override
  Future<void> addToRoom(int id, int bookingId, int roomId, {num discountAmount = 0}) =>
      api.barAddToRoom(id, bookingId, roomId, discountAmount: discountAmount);

  @override
  Future<List<BarTab>> tabs() => api.barTabs();

  @override
  Future<BarBill> issueBill(Map<String, dynamic> body) => api.issueBarBill(body);

  @override
  Future<BarBill> bill(int id) => api.barBill(id);

  @override
  Future<List<BarBillRow>> bills(String from, String to) => api.barBills(from, to);

  @override
  Future<BarSales> salesReport(String from, String to) => api.barSalesReport(from, to);

  @override
  Future<List<BarStockRow>> stockReport(String from, String to) => api.barStockReport(from, to);
}
