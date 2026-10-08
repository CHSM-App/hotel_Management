import '../models/customer.dart';
import '../repository/customers_repo.dart';

class CustomersUsecase {
  final CustomersRepository repository;

  CustomersUsecase(this.repository);

  Future<CustomersResult> customers() => repository.customers();

  Future<CustomerDetail> customer(int id) => repository.customer(id);

  Future<int> createCustomer(Map<String, dynamic> body) =>
      repository.createCustomer(body);

  Future<Customer?> updateCustomer(int id, Map<String, dynamic> body) =>
      repository.updateCustomer(id, body);
}
