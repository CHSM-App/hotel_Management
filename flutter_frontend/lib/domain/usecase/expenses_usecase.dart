import 'package:dio/dio.dart';

import '../models/asset.dart' show Vendor;
import '../models/expense.dart';
import '../repository/expenses_repo.dart';

class ExpensesUsecase {
  final ExpensesRepository repository;

  ExpensesUsecase(this.repository);

  Future<List<ExpenseCategory>> categories({bool includeInactive = false}) =>
      repository.categories(includeInactive: includeInactive);

  Future<ExpenseCategory> createCategory(String name) => repository.createCategory(name);

  Future<void> updateCategory(int id, {String? name, bool? isActive}) =>
      repository.updateCategory(id, name: name, isActive: isActive);

  Future<List<Vendor>> vendors({bool includeInactive = false}) =>
      repository.vendors(includeInactive: includeInactive);

  Future<Vendor> createVendor(Map<String, dynamic> body) => repository.createVendor(body);

  Future<void> updateVendor(int id, Map<String, dynamic> body) =>
      repository.updateVendor(id, body);

  Future<List<Expense>> expenses({
    int? categoryId,
    int? vendorId,
    int? assetId,
    int? recurringTemplateId,
    String? from,
    String? to,
  }) => repository.expenses(
    categoryId: categoryId,
    vendorId: vendorId,
    assetId: assetId,
    recurringTemplateId: recurringTemplateId,
    from: from,
    to: to,
  );

  Future<Expense> expense(int id) => repository.expense(id);

  Future<Expense> createExpense(FormData form) => repository.createExpense(form);

  Future<Expense> updateExpense(int id, FormData form) => repository.updateExpense(id, form);

  Future<void> deleteExpense(int id) => repository.deleteExpense(id);

  Future<List<ExpensePayment>> expensePayments(int expenseId) =>
      repository.expensePayments(expenseId);

  Future<Expense> addExpensePayment(int expenseId, Map<String, dynamic> body) =>
      repository.addExpensePayment(expenseId, body);

  Future<Expense> deleteExpensePayment(int expenseId, int paymentId) =>
      repository.deleteExpensePayment(expenseId, paymentId);

  Future<Response<List<int>>> expenseBill(int id) => repository.expenseBill(id);

  Future<ExpenseSummary> summary({int? year}) => repository.summary(year: year);

  Future<List<RecurringTemplate>> templates({bool includeInactive = false}) =>
      repository.templates(includeInactive: includeInactive);

  Future<RecurringTemplate> createTemplate(Map<String, dynamic> body) =>
      repository.createTemplate(body);

  Future<RecurringTemplate> updateTemplate(int id, Map<String, dynamic> body) =>
      repository.updateTemplate(id, body);

  Future<Expense> logOccurrence(int templateId, FormData form) =>
      repository.logOccurrence(templateId, form);
}
