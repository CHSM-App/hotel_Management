import '../../domain/models/customer.dart';
import '../../domain/repository/customers_repo.dart';
import '../api/api_service.dart';

class CustomersImpl implements CustomersRepository {
  final ApiService api;

  CustomersImpl(this.api);

  @override
  Future<CustomersResult> customers() => api.customers();

  @override
  Future<CustomerDetail> customer(int id) => api.customer(id);

  @override
  Future<int> createCustomer(Map<String, dynamic> body) =>
      api.createCustomer(body);

  @override
  Future<Customer?> updateCustomer(int id, Map<String, dynamic> body) =>
      api.updateCustomer(id, body);
}
