import 'package:dio/dio.dart';

import '../../domain/models/asset.dart' show Vendor;
import '../../domain/models/income.dart';
import '../../domain/repository/income_repo.dart';
import '../api/api_service.dart';

class IncomeImpl implements IncomeRepository {
  final ApiService api;

  IncomeImpl(this.api);

  @override
  Future<List<IncomeCategory>> categories({bool includeInactive = false}) =>
      api.incomeCategories(includeInactive: includeInactive);

  @override
  Future<IncomeCategory> createCategory(String name) => api.createIncomeCategory(name);

  @override
  Future<void> updateCategory(int id, {String? name, bool? isActive}) =>
      api.updateIncomeCategory(id, name: name, isActive: isActive);

  @override
  Future<List<Vendor>> payers({bool includeInactive = false}) =>
      api.incomePayers(includeInactive: includeInactive);

  @override
  Future<Vendor> createPayer(Map<String, dynamic> body) => api.createIncomePayer(body);

  @override
  Future<void> updatePayer(int id, Map<String, dynamic> body) => api.updateIncomePayer(id, body);

  @override
  Future<List<IncomeEntry>> income({
    int? categoryId,
    int? payerId,
    int? recurringTemplateId,
    String? from,
    String? to,
  }) => api.income(
    categoryId: categoryId,
    payerId: payerId,
    recurringTemplateId: recurringTemplateId,
    from: from,
    to: to,
  );

  @override
  Future<IncomeEntry> incomeEntry(int id) => api.incomeEntry(id);

  @override
  Future<IncomeEntry> createIncome(FormData form) => api.createIncomeEntry(form);

  @override
  Future<IncomeEntry> updateIncome(int id, FormData form) => api.updateIncomeEntry(id, form);

  @override
  Future<void> deleteIncome(int id) => api.deleteIncomeEntry(id);

  @override
  Future<List<IncomeReceipt>> incomeReceipts(int incomeId) => api.incomeReceipts(incomeId);

  @override
  Future<IncomeEntry> addIncomeReceipt(int incomeId, Map<String, dynamic> body) =>
      api.addIncomeReceipt(incomeId, body);

  @override
  Future<IncomeEntry> deleteIncomeReceipt(int incomeId, int receiptId) =>
      api.deleteIncomeReceipt(incomeId, receiptId);

  @override
  Future<Response<List<int>>> incomeReceiptFile(int id) => api.incomeReceiptFile(id);

  @override
  Future<IncomeSummary> summary({int? year}) => api.incomeSummary(year: year);

  @override
  Future<List<IncomeRecurringTemplate>> templates({bool includeInactive = false}) =>
      api.incomeRecurringTemplates(includeInactive: includeInactive);

  @override
  Future<IncomeRecurringTemplate> createTemplate(Map<String, dynamic> body) =>
      api.createIncomeRecurringTemplate(body);

  @override
  Future<IncomeRecurringTemplate> updateTemplate(int id, Map<String, dynamic> body) =>
      api.updateIncomeRecurringTemplate(id, body);

  @override
  Future<IncomeEntry> logOccurrence(int templateId, FormData form) =>
      api.logIncomeRecurringOccurrence(templateId, form);
}
