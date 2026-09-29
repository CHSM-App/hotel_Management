import 'package:dio/dio.dart';

import '../models/asset.dart' show Vendor;
import '../models/income.dart';
import '../repository/income_repo.dart';

class IncomeUsecase {
  final IncomeRepository repository;

  IncomeUsecase(this.repository);

  Future<List<IncomeCategory>> categories({bool includeInactive = false}) =>
      repository.categories(includeInactive: includeInactive);

  Future<IncomeCategory> createCategory(String name) => repository.createCategory(name);

  Future<void> updateCategory(int id, {String? name, bool? isActive}) =>
      repository.updateCategory(id, name: name, isActive: isActive);

  Future<List<Vendor>> payers({bool includeInactive = false}) =>
      repository.payers(includeInactive: includeInactive);

  Future<Vendor> createPayer(Map<String, dynamic> body) => repository.createPayer(body);

  Future<void> updatePayer(int id, Map<String, dynamic> body) => repository.updatePayer(id, body);

  Future<List<IncomeEntry>> income({
    int? categoryId,
    int? payerId,
    int? recurringTemplateId,
    String? from,
    String? to,
  }) => repository.income(
    categoryId: categoryId,
    payerId: payerId,
    recurringTemplateId: recurringTemplateId,
    from: from,
    to: to,
  );

  Future<IncomeEntry> incomeEntry(int id) => repository.incomeEntry(id);

  Future<IncomeEntry> createIncome(FormData form) => repository.createIncome(form);

  Future<IncomeEntry> updateIncome(int id, FormData form) => repository.updateIncome(id, form);

  Future<void> deleteIncome(int id) => repository.deleteIncome(id);

  Future<List<IncomeReceipt>> incomeReceipts(int incomeId) => repository.incomeReceipts(incomeId);

  Future<IncomeEntry> addIncomeReceipt(int incomeId, Map<String, dynamic> body) =>
      repository.addIncomeReceipt(incomeId, body);

  Future<IncomeEntry> deleteIncomeReceipt(int incomeId, int receiptId) =>
      repository.deleteIncomeReceipt(incomeId, receiptId);

  Future<Response<List<int>>> incomeReceiptFile(int id) => repository.incomeReceiptFile(id);

  Future<IncomeSummary> summary({int? year}) => repository.summary(year: year);

  Future<List<IncomeRecurringTemplate>> templates({bool includeInactive = false}) =>
      repository.templates(includeInactive: includeInactive);

  Future<IncomeRecurringTemplate> createTemplate(Map<String, dynamic> body) =>
      repository.createTemplate(body);

  Future<IncomeRecurringTemplate> updateTemplate(int id, Map<String, dynamic> body) =>
      repository.updateTemplate(id, body);

  Future<IncomeEntry> logOccurrence(int templateId, FormData form) =>
      repository.logOccurrence(templateId, form);
}
