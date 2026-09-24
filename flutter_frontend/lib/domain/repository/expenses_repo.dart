import 'package:dio/dio.dart';

import '../models/asset.dart' show Vendor;
import '../models/expense.dart';

/// Expense tracking — mirrors ExpensesPanel.jsx. Vendor is the module's
/// shared model, reused as-is (see domain/models/asset.dart).
abstract class ExpensesRepository {
  Future<List<ExpenseCategory>> categories({bool includeInactive = false});

  Future<ExpenseCategory> createCategory(String name);

  Future<void> updateCategory(int id, {String? name, bool? isActive});

  Future<List<Vendor>> vendors({bool includeInactive = false});

  Future<Vendor> createVendor(Map<String, dynamic> body);

  Future<void> updateVendor(int id, Map<String, dynamic> body);

  Future<List<Expense>> expenses({
    int? categoryId,
    int? vendorId,
    String? from,
    String? to,
  });

  Future<Expense> expense(int id);

  Future<Expense> createExpense(FormData form);

  Future<Expense> updateExpense(int id, FormData form);

  Future<void> deleteExpense(int id);

  Future<Response<List<int>>> expenseBill(int id);

  Future<ExpenseSummary> summary({int? year});

  Future<List<RecurringTemplate>> templates({bool includeInactive = false});

  Future<RecurringTemplate> createTemplate(Map<String, dynamic> body);

  Future<RecurringTemplate> updateTemplate(int id, Map<String, dynamic> body);

  Future<int> generateDue();
}
