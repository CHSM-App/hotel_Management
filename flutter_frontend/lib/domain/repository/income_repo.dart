import '../models/income.dart';

/// Other income — read-only so far, for the Reports > Other Income tab.
/// Mirrors the read side of income.service.js; there's no entry/edit screen
/// elsewhere in this app yet to warrant the rest of the CRUD surface.
abstract class IncomeRepository {
  Future<List<IncomeEntry>> income({
    int? categoryId,
    int? payerId,
    String? from,
    String? to,
  });

  Future<List<IncomeCategory>> categories({bool includeInactive = false});
}
