import '../../domain/models/income.dart';
import '../../domain/repository/income_repo.dart';
import '../api/api_service.dart';

class IncomeImpl implements IncomeRepository {
  final ApiService api;

  IncomeImpl(this.api);

  @override
  Future<List<IncomeEntry>> income({
    int? categoryId,
    int? payerId,
    String? from,
    String? to,
  }) => api.income(categoryId: categoryId, payerId: payerId, from: from, to: to);

  @override
  Future<List<IncomeCategory>> categories({bool includeInactive = false}) =>
      api.incomeCategories(includeInactive: includeInactive);
}
