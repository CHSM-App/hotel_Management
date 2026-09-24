import 'package:dio/dio.dart';

import '../../domain/models/asset.dart' show Vendor;
import '../../domain/models/expense.dart';
import '../../domain/repository/expenses_repo.dart';
import '../api/api_service.dart';

class ExpensesImpl implements ExpensesRepository {
  final ApiService api;

  ExpensesImpl(this.api);

  @override
  Future<List<ExpenseCategory>> categories({bool includeInactive = false}) =>
      api.expenseCategories(includeInactive: includeInactive);

  @override
  Future<ExpenseCategory> createCategory(String name) => api.createExpenseCategory(name);

  @override
  Future<void> updateCategory(int id, {String? name, bool? isActive}) =>
      api.updateExpenseCategory(id, name: name, isActive: isActive);

  @override
  Future<List<Vendor>> vendors({bool includeInactive = false}) =>
      api.expenseVendors(includeInactive: includeInactive);

  @override
  Future<Vendor> createVendor(Map<String, dynamic> body) => api.createExpenseVendor(body);

  @override
  Future<void> updateVendor(int id, Map<String, dynamic> body) =>
      api.updateExpenseVendor(id, body);

  @override
  Future<List<Expense>> expenses({
    int? categoryId,
    int? vendorId,
    String? from,
    String? to,
  }) => api.expenses(categoryId: categoryId, vendorId: vendorId, from: from, to: to);

  @override
  Future<Expense> expense(int id) => api.expense(id);

  @override
  Future<Expense> createExpense(FormData form) => api.createExpense(form);

  @override
  Future<Expense> updateExpense(int id, FormData form) => api.updateExpense(id, form);

  @override
  Future<void> deleteExpense(int id) => api.deleteExpense(id);

  @override
  Future<Response<List<int>>> expenseBill(int id) => api.expenseBill(id);

  @override
  Future<ExpenseSummary> summary({int? year}) => api.expenseSummary(year: year);

  @override
  Future<List<RecurringTemplate>> templates({bool includeInactive = false}) =>
      api.recurringTemplates(includeInactive: includeInactive);

  @override
  Future<RecurringTemplate> createTemplate(Map<String, dynamic> body) =>
      api.createRecurringTemplate(body);

  @override
  Future<RecurringTemplate> updateTemplate(int id, Map<String, dynamic> body) =>
      api.updateRecurringTemplate(id, body);

  @override
  Future<int> generateDue() => api.generateDueExpenses();
}
