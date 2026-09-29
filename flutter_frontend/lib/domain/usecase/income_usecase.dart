import '../models/income.dart';
import '../repository/income_repo.dart';

class IncomeUsecase {
  final IncomeRepository repository;

  IncomeUsecase(this.repository);

  Future<List<IncomeEntry>> income({
    int? categoryId,
    int? payerId,
    String? from,
    String? to,
  }) => repository.income(categoryId: categoryId, payerId: payerId, from: from, to: to);

  Future<List<IncomeCategory>> categories({bool includeInactive = false}) =>
      repository.categories(includeInactive: includeInactive);
}
