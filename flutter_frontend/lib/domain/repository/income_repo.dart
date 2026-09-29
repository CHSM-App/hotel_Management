import 'package:dio/dio.dart';

import '../models/asset.dart' show Vendor;
import '../models/income.dart';

/// Other income tracking — mirrors ExpensesRepository/IncomePanel.jsx. Payer
/// is the same shared Vendor model Expenses reuses (see domain/models/asset.dart),
/// stored through dbo.vendors with type 'income'.
abstract class IncomeRepository {
  Future<List<IncomeCategory>> categories({bool includeInactive = false});

  Future<IncomeCategory> createCategory(String name);

  Future<void> updateCategory(int id, {String? name, bool? isActive});

  Future<List<Vendor>> payers({bool includeInactive = false});

  Future<Vendor> createPayer(Map<String, dynamic> body);

  Future<void> updatePayer(int id, Map<String, dynamic> body);

  Future<List<IncomeEntry>> income({
    int? categoryId,
    int? payerId,
    int? recurringTemplateId,
    String? from,
    String? to,
  });

  Future<IncomeEntry> incomeEntry(int id);

  Future<IncomeEntry> createIncome(FormData form);

  Future<IncomeEntry> updateIncome(int id, FormData form);

  Future<void> deleteIncome(int id);

  Future<List<IncomeReceipt>> incomeReceipts(int incomeId);

  Future<IncomeEntry> addIncomeReceipt(int incomeId, Map<String, dynamic> body);

  Future<IncomeEntry> deleteIncomeReceipt(int incomeId, int receiptId);

  Future<Response<List<int>>> incomeReceiptFile(int id);

  Future<IncomeSummary> summary({int? year});

  Future<List<IncomeRecurringTemplate>> templates({bool includeInactive = false});

  Future<IncomeRecurringTemplate> createTemplate(Map<String, dynamic> body);

  Future<IncomeRecurringTemplate> updateTemplate(int id, Map<String, dynamic> body);

  Future<IncomeEntry> logOccurrence(int templateId, FormData form);
}
