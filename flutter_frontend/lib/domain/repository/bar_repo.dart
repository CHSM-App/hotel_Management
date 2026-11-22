import '../models/bar.dart';
import '../models/menu.dart';

/// Bar module (orders, billing, menu and stock, reports). Online only.
abstract class BarRepository {
  Future<BarMenu> menu();

  Future<BarSettings> updateSettings(Map<String, dynamic> body);

  Future<void> saveCategory(int? id, Map<String, dynamic> body);

  Future<void> deleteCategory(int id);

  Future<void> createProduct(Map<String, dynamic> body);

  Future<void> updateProduct(int id, Map<String, dynamic> body);

  Future<void> addSize(int productId, Map<String, dynamic> body);

  Future<void> updateSize(int sizeId, Map<String, dynamic> body);

  Future<void> adjustStock(int productId, Map<String, dynamic> body);

  Future<List<BarMovement>> movements(int productId);

  Future<List<BarOrder>> orders();

  Future<List<BarOrder>> history(String from, String to);

  Future<BarTargets> targets();

  Future<List<MenuSection>> foodMenu();

  Future<void> createOrder(Map<String, dynamic> body);

  Future<void> addItems(int id, Map<String, dynamic> body);

  Future<void> setItemQty(int id, int itemId, int quantity);

  Future<void> cancelItem(int id, int itemId);

  Future<void> cancelOrder(int id);

  Future<void> deliverOrder(int id);

  Future<void> deliverItem(int id, int itemId);

  Future<void> deliverFoodItem(int foodOrderId, int itemId);

  Future<void> readyToBill(int id);
  Future<void> setCustomer(int id, String? tag);

  Future<void> addToRoom(int id, int bookingId, int roomId);

  Future<List<BarTab>> tabs();

  Future<BarBill> issueBill(Map<String, dynamic> body);

  Future<BarBill> bill(int id);

  Future<List<BarBillRow>> bills(String from, String to);

  Future<BarSales> salesReport(String from, String to);

  Future<List<BarStockRow>> stockReport(String from, String to);
}
