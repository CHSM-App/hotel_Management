import '../models/customer.dart';

/// Customers this property has done business with — mirrors Customers.jsx's
/// own fetches exactly: one list+stats call, one detail+history call per
/// profile opened.
abstract class CustomersRepository {
  Future<CustomersResult> customers();

  Future<CustomerDetail> customer(int id);

  /// Answers with the new customer's id — the caller reloads [customers]
  /// itself rather than trusting a partial echo back.
  Future<int> createCustomer(Map<String, dynamic> body);

  Future<Customer?> updateCustomer(int id, Map<String, dynamic> body);

  /// The guest-submitted feedback tab's data — not scoped per customer, one
  /// call for the whole property, same as the web's `/customers/feedback`.
  Future<CustomerFeedbackResult> feedback();
}
