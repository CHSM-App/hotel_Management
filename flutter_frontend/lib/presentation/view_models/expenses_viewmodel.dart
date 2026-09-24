library;

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/asset.dart' show Vendor;
import '../../domain/models/expense.dart';
import '../../domain/usecase/expenses_usecase.dart';

/// Expense tracking — one notifier for the whole section, the same shape as
/// AssetsViewModel/EventsViewModel: log, summary and recurring-template
/// state kept together the way ExpensesPanel.jsx keeps them in one component.
class ExpensesState {
  final bool isLoading;
  final String? error;
  final List<Expense> expenses;
  final List<ExpenseCategory> categories;
  final List<Vendor> vendors;
  final List<RecurringTemplate> templates;
  final ExpenseSummary? summary;
  final bool catalogueLoading;
  final bool submitting;
  final int bumps;

  const ExpensesState({
    this.isLoading = false,
    this.error,
    this.expenses = const [],
    this.categories = const [],
    this.vendors = const [],
    this.templates = const [],
    this.summary,
    this.catalogueLoading = false,
    this.submitting = false,
    this.bumps = 0,
  });

  ExpensesState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    List<Expense>? expenses,
    List<ExpenseCategory>? categories,
    List<Vendor>? vendors,
    List<RecurringTemplate>? templates,
    ExpenseSummary? summary,
    bool? catalogueLoading,
    bool? submitting,
    int? bumps,
  }) => ExpensesState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    expenses: expenses ?? this.expenses,
    categories: categories ?? this.categories,
    vendors: vendors ?? this.vendors,
    templates: templates ?? this.templates,
    summary: summary ?? this.summary,
    catalogueLoading: catalogueLoading ?? this.catalogueLoading,
    submitting: submitting ?? this.submitting,
    bumps: bumps ?? this.bumps,
  );

  List<ExpenseCategory> get activeCategories => categories.where((c) => c.isActive).toList();

  List<Vendor> get activeVendors => vendors.where((v) => v.isActive).toList();

  num get monthTotal {
    if (expenses.isEmpty) return 0;
    return expenses.fold<num>(0, (sum, e) => sum + e.amount);
  }
}

class ExpensesViewModel extends StateNotifier<ExpensesState> {
  final ExpensesUsecase usecase;

  ExpensesViewModel(this.usecase) : super(const ExpensesState());

  Future<void> loadExpenses({
    int? categoryId,
    int? vendorId,
    String? from,
    String? to,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final expenses = await usecase.expenses(
        categoryId: categoryId,
        vendorId: vendorId,
        from: from,
        to: to,
      );
      state = state.copyWith(isLoading: false, expenses: expenses);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadCatalogue() async {
    state = state.copyWith(catalogueLoading: true, clearError: true);
    try {
      final results = await Future.wait([
        usecase.categories(includeInactive: true),
        usecase.vendors(includeInactive: true),
        usecase.templates(includeInactive: true),
      ]);
      state = state.copyWith(
        catalogueLoading: false,
        categories: results[0] as List<ExpenseCategory>,
        vendors: results[1] as List<Vendor>,
        templates: results[2] as List<RecurringTemplate>,
      );
    } catch (e) {
      state = state.copyWith(catalogueLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadSummary({int? year}) async {
    try {
      final summary = await usecase.summary(year: year);
      state = state.copyWith(summary: summary);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
    }
  }

  void _bump() => state = state.copyWith(bumps: state.bumps + 1);

  /// Recurring templates whose nextDueDate has arrived are turned into real
  /// expense rows the moment the section opens — mirrors
  /// generateDueThenLoad in ExpensesPanel.jsx. Silent on failure: this is a
  /// convenience, not something worth surfacing an error banner over.
  Future<int> generateDueSilently() async {
    try {
      final count = await usecase.generateDue();
      if (count > 0) _bump();
      return count;
    } catch (_) {
      return 0;
    } finally {
      loadExpenses();
      loadCatalogue();
    }
  }

  /// Resolves a typed category name to its id, creating the category first
  /// if nothing on file matches it (case-insensitively) — mirrors
  /// resolveCategoryId in ExpensesPanel.jsx. The expense/recurring forms are
  /// the only place a category gets named; there is no separate "manage
  /// categories" screen.
  Future<int> resolveCategoryId(String name) async {
    final trimmed = name.trim();
    final existing = state.categories.firstWhere(
      (c) => c.name.toLowerCase() == trimmed.toLowerCase(),
      orElse: () => const ExpenseCategory(id: 0),
    );
    if (existing.id != 0) return existing.id;
    final created = await usecase.createCategory(trimmed);
    await loadCatalogue();
    return created.id;
  }

  /// Same idea as [resolveCategoryId]: a vendor picked from the suggestion
  /// list already carries an id, so this only reaches the network for a
  /// name typed fresh. Mirrors resolveVendorId in ExpensesPanel.jsx.
  Future<int?> resolveVendorId(String name, {int? pickedId}) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return null;
    if (pickedId != null) return pickedId;
    final existing = state.vendors.firstWhere(
      (v) => v.name.toLowerCase() == trimmed.toLowerCase(),
      orElse: () => const Vendor(id: 0),
    );
    if (existing.id != 0) return existing.id;
    final created = await usecase.createVendor({'name': trimmed});
    await loadCatalogue();
    return created.id;
  }

  // ── Categories & vendors ─────────────────────────────────────────────

  Future<bool> saveCategory(String name, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateCategory(id, name: name);
      } else {
        await usecase.createCategory(name);
      }
      state = state.copyWith(submitting: false);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> toggleCategory(ExpenseCategory category) async {
    try {
      await usecase.updateCategory(category.id, isActive: !category.isActive);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> saveVendor(Map<String, dynamic> body, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateVendor(id, body);
      } else {
        await usecase.createVendor(body);
      }
      state = state.copyWith(submitting: false);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  // ── Expenses ──────────────────────────────────────────────────────────

  Future<Expense?> fetchExpense(int id) async {
    try {
      return await usecase.expense(id);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }

  Future<bool> saveExpense(FormData form, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateExpense(id, form);
      } else {
        await usecase.createExpense(form);
      }
      state = state.copyWith(submitting: false);
      _bump();
      await loadExpenses();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> deleteExpense(int id) async {
    try {
      await usecase.deleteExpense(id);
      _bump();
      await loadExpenses();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  // ── Payments ──────────────────────────────────────────────────────────
  // A bill can be settled in more than one payment — mirrors loadPayments /
  // handleAddPayment / handleDeletePayment in ExpensesPanel.jsx. Only
  // meaningful once the expense exists, so these take the expense id
  // explicitly rather than living on ExpensesState.

  Future<List<ExpensePayment>> loadPayments(int expenseId) async {
    try {
      return await usecase.expensePayments(expenseId);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return const [];
    }
  }

  /// Adds a payment and refreshes the expense list/summary so every other
  /// screen's paymentStatus/amountPaid stay in sync. Answers with the
  /// expense's own updated totals, or null on failure.
  Future<Expense?> addPayment(int expenseId, Map<String, dynamic> body) async {
    try {
      final expense = await usecase.addExpensePayment(expenseId, body);
      await Future.wait([loadExpenses(), loadSummary()]);
      return expense;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }

  Future<Expense?> deletePayment(int expenseId, int paymentId) async {
    try {
      final expense = await usecase.deleteExpensePayment(expenseId, paymentId);
      await Future.wait([loadExpenses(), loadSummary()]);
      return expense;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }

  // ── Recurring templates ───────────────────────────────────────────────

  Future<bool> saveTemplate(Map<String, dynamic> body, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateTemplate(id, body);
      } else {
        await usecase.createTemplate(body);
      }
      state = state.copyWith(submitting: false);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> toggleTemplate(RecurringTemplate template) async {
    try {
      await usecase.updateTemplate(template.id, {'isActive': !template.isActive});
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  void clearError() => state = state.copyWith(clearError: true);
}
