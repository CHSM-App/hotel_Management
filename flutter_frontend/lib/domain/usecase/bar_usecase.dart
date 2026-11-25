import '../models/bar.dart';
import '../models/menu.dart';
import '../repository/bar_repo.dart';

class BarUsecase {
  final BarRepository repository;

  BarUsecase(this.repository);

  Future<BarMenu> menu() => repository.menu();

  Future<BarSettings> updateSettings(Map<String, dynamic> body) => repository.updateSettings(body);

  Future<void> saveCategory(int? id, Map<String, dynamic> body) => repository.saveCategory(id, body);

  Future<void> deleteCategory(int id) => repository.deleteCategory(id);

  Future<void> createProduct(Map<String, dynamic> body) => repository.createProduct(body);

  Future<void> updateProduct(int id, Map<String, dynamic> body) => repository.updateProduct(id, body);

  Future<void> addSize(int productId, Map<String, dynamic> body) => repository.addSize(productId, body);

  Future<void> updateSize(int sizeId, Map<String, dynamic> body) => repository.updateSize(sizeId, body);

  Future<void> adjustStock(int productId, Map<String, dynamic> body) => repository.adjustStock(productId, body);

  Future<List<BarMovement>> movements(int productId) => repository.movements(productId);

  Future<List<BarOrder>> orders() => repository.orders();

  Future<List<BarOrder>> history(String from, String to) => repository.history(from, to);

  Future<BarTargets> targets() => repository.targets();

  Future<List<MenuSection>> foodMenu() => repository.foodMenu();

  Future<int> createOrder(Map<String, dynamic> body) => repository.createOrder(body);

  Future<void> addItems(int id, Map<String, dynamic> body) => repository.addItems(id, body);

  Future<void> setItemQty(int id, int itemId, int quantity) => repository.setItemQty(id, itemId, quantity);

  Future<void> cancelItem(int id, int itemId) => repository.cancelItem(id, itemId);

  Future<void> cancelOrder(int id) => repository.cancelOrder(id);

  Future<void> deliverOrder(int id) => repository.deliverOrder(id);

  Future<void> deliverItem(int id, int itemId) => repository.deliverItem(id, itemId);

  Future<void> deliverFoodItem(int foodOrderId, int itemId) => repository.deliverFoodItem(foodOrderId, itemId);

  Future<void> setCustomer(int id, String? tag) => repository.setCustomer(id, tag);

  Future<void> addToRoom(int id, int bookingId, int roomId, {num discountAmount = 0}) =>
      repository.addToRoom(id, bookingId, roomId, discountAmount: discountAmount);

  Future<List<BarTab>> tabs() => repository.tabs();

  Future<BarBill> issueBill(Map<String, dynamic> body) => repository.issueBill(body);

  Future<BarBill> bill(int id) => repository.bill(id);

  Future<List<BarBillRow>> bills(String from, String to) => repository.bills(from, to);

  Future<BarSales> salesReport(String from, String to) => repository.salesReport(from, to);

  Future<List<BarStockRow>> stockReport(String from, String to) => repository.stockReport(from, to);
}
