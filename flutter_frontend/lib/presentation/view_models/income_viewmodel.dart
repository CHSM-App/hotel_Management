library;

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/asset.dart' show Vendor;
import '../../domain/models/income.dart';
import '../../domain/usecase/income_usecase.dart';

/// Other income tracking — one notifier for the whole section, mirroring
/// ExpensesViewModel/ExpensesState exactly: log, summary and
/// recurring-template state kept together the way IncomePanel.jsx keeps them
/// in one component.
class IncomeState {
  final bool isLoading;
  final String? error;

  /// The backend's name for the field [error] is about (e.g. "name" for "A
  /// payer with that name already exists."), from [apiErrorField] — lets a
  /// form focus the exact field instead of leaving the user to guess from
  /// a banner alone. Null when the error isn't about one field.
  final String? errorField;
  final List<IncomeEntry> income;
  final List<IncomeCategory> categories;
  final List<Vendor> payers;
  final List<IncomeRecurringTemplate> templates;
  final IncomeSummary? summary;
  final bool catalogueLoading;
  final bool submitting;
  final int bumps;

  const IncomeState({
    this.isLoading = false,
    this.error,
    this.errorField,
    this.income = const [],
    this.categories = const [],
    this.payers = const [],
    this.templates = const [],
    this.summary,
    this.catalogueLoading = false,
    this.submitting = false,
    this.bumps = 0,
  });

  IncomeState copyWith({
    bool? isLoading,
    String? error,
    String? errorField,
    bool clearError = false,
    List<IncomeEntry>? income,
    List<IncomeCategory>? categories,
    List<Vendor>? payers,
    List<IncomeRecurringTemplate>? templates,
    IncomeSummary? summary,
    bool? catalogueLoading,
    bool? submitting,
    int? bumps,
  }) => IncomeState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    errorField: clearError ? null : (errorField ?? this.errorField),
    income: income ?? this.income,
    categories: categories ?? this.categories,
    payers: payers ?? this.payers,
    templates: templates ?? this.templates,
    summary: summary ?? this.summary,
    catalogueLoading: catalogueLoading ?? this.catalogueLoading,
    submitting: submitting ?? this.submitting,
    bumps: bumps ?? this.bumps,
  );

  List<IncomeCategory> get activeCategories => categories.where((c) => c.isActive).toList();

  List<Vendor> get activePayers => payers.where((p) => p.isActive).toList();

  num get monthTotal {
    if (income.isEmpty) return 0;
    return income.fold<num>(0, (sum, e) => sum + e.amount);
  }
}

class IncomeViewModel extends StateNotifier<IncomeState> {
  final IncomeUsecase usecase;

  IncomeViewModel(this.usecase) : super(const IncomeState());

  Future<void> loadIncome({
    int? categoryId,
    int? payerId,
    String? from,
    String? to,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final income = await usecase.income(
        categoryId: categoryId,
        payerId: payerId,
        from: from,
        to: to,
      );
      state = state.copyWith(isLoading: false, income: income);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e), errorField: apiErrorField(e));
    }
  }

  Future<void> loadCatalogue() async {
    state = state.copyWith(catalogueLoading: true, clearError: true);
    try {
      final results = await Future.wait([
        usecase.categories(includeInactive: true),
        usecase.payers(includeInactive: true),
        // Unlike loadTemplates in IncomePanel.jsx (which never sends
        // includeInactive, so a paused template drops out of its list
        // entirely), this asks for inactive ones too — otherwise the
        // "Paused" badge and "Resume" button in IncomeRecurringPanel would be
        // dead code: the template that needs them would already be gone from
        // state.templates the moment it's paused.
        usecase.templates(includeInactive: true),
      ]);
      state = state.copyWith(
        catalogueLoading: false,
        categories: results[0] as List<IncomeCategory>,
        payers: results[1] as List<Vendor>,
        templates: results[2] as List<IncomeRecurringTemplate>,
      );
    } catch (e) {
      state = state.copyWith(catalogueLoading: false, error: apiErrorMessage(e), errorField: apiErrorField(e));
    }
  }

  Future<void> loadSummary({int? year}) async {
    try {
      final summary = await usecase.summary(year: year);
      state = state.copyWith(summary: summary);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e), errorField: apiErrorField(e));
    }
  }

  void _bump() => state = state.copyWith(bumps: state.bumps + 1);

  /// Resolves a typed category name to its id, creating the category first if
  /// nothing on file matches it (case-insensitively) — mirrors
  /// resolveCategoryId in IncomePanel.jsx. The income/recurring forms are the
  /// only place a category gets named; there is no separate "manage
  /// categories" screen.
  Future<int> resolveCategoryId(String name) async {
    final trimmed = name.trim();
    final existing = state.categories.firstWhere(
      (c) => c.name.toLowerCase() == trimmed.toLowerCase(),
      orElse: () => const IncomeCategory(id: 0),
    );
    if (existing.id != 0) return existing.id;
    final created = await usecase.createCategory(trimmed);
    await loadCatalogue();
    return created.id;
  }

  /// Same idea as [resolveCategoryId]: a payer picked from the suggestion
  /// list already carries an id, so this only reaches the network for a name
  /// typed fresh. Mirrors resolvePayerId in IncomePanel.jsx.
  Future<int?> resolvePayerId(String name, {int? pickedId, Map<String, dynamic>? extra}) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return null;
    if (pickedId != null) return pickedId;
    final existing = state.payers.firstWhere(
      (p) => p.name.toLowerCase() == trimmed.toLowerCase(),
      orElse: () => const Vendor(id: 0),
    );
    if (existing.id != 0) return existing.id;
    final created = await usecase.createPayer({'name': trimmed, ...?extra});
    await loadCatalogue();
    return created.id;
  }

  // ── Categories & payers ───────────────────────────────────────────────

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
      state = state.copyWith(submitting: false, error: apiErrorMessage(e), errorField: apiErrorField(e));
      return false;
    }
  }

  Future<bool> savePayer(Map<String, dynamic> body, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updatePayer(id, body);
      } else {
        await usecase.createPayer(body);
      }
      state = state.copyWith(submitting: false);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e), errorField: apiErrorField(e));
      return false;
    }
  }

  // ── Income ────────────────────────────────────────────────────────────

  Future<IncomeEntry?> fetchIncome(int id) async {
    try {
      return await usecase.incomeEntry(id);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e), errorField: apiErrorField(e));
      return null;
    }
  }

  Future<bool> saveIncome(FormData form, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateIncome(id, form);
      } else {
        await usecase.createIncome(form);
      }
      state = state.copyWith(submitting: false);
      _bump();
      await Future.wait([loadIncome(), loadSummary()]);
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e), errorField: apiErrorField(e));
      return false;
    }
  }

  Future<bool> deleteIncome(int id) async {
    try {
      await usecase.deleteIncome(id);
      _bump();
      await Future.wait([loadIncome(), loadSummary()]);
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e), errorField: apiErrorField(e));
      return false;
    }
  }

  // ── Receipts ──────────────────────────────────────────────────────────
  // An income entry can be settled in more than one receipt — mirrors
  // loadReceipts / handleAddReceipt / handleDeleteReceipt in IncomePanel.jsx.
  // Only meaningful once the entry exists, so these take the entry id
  // explicitly rather than living on IncomeState.

  Future<List<IncomeReceipt>> loadReceipts(int incomeId) async {
    try {
      return await usecase.incomeReceipts(incomeId);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e), errorField: apiErrorField(e));
      return const [];
    }
  }

  /// Adds a receipt and refreshes the income list/summary so every other
  /// screen's paymentStatus/amountReceived stay in sync. Answers with the
  /// entry's own updated totals, or null on failure.
  Future<IncomeEntry?> addReceipt(int incomeId, Map<String, dynamic> body) async {
    try {
      final entry = await usecase.addIncomeReceipt(incomeId, body);
      await Future.wait([loadIncome(), loadSummary()]);
      return entry;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e), errorField: apiErrorField(e));
      return null;
    }
  }

  Future<IncomeEntry?> deleteReceipt(int incomeId, int receiptId) async {
    try {
      final entry = await usecase.deleteIncomeReceipt(incomeId, receiptId);
      await Future.wait([loadIncome(), loadSummary()]);
      return entry;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e), errorField: apiErrorField(e));
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
      state = state.copyWith(submitting: false, error: apiErrorMessage(e), errorField: apiErrorField(e));
      return false;
    }
  }

  Future<bool> toggleTemplate(IncomeRecurringTemplate template) async {
    try {
      await usecase.updateTemplate(template.id, {'isActive': !template.isActive});
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e), errorField: apiErrorField(e));
      return false;
    }
  }

  /// "Log this month" — records one occurrence of a recurring template as a
  /// real income entry (its own amount/payer/payment, entered in the form),
  /// linked back via recurringTemplateId. Advances the template's
  /// nextDueDate server-side, so the catalogue is reloaded too. Mirrors
  /// handleIncomeSubmit's logUrl branch in IncomePanel.jsx.
  Future<bool> logOccurrence(int templateId, FormData form) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.logOccurrence(templateId, form);
      state = state.copyWith(submitting: false);
      _bump();
      await Future.wait([loadIncome(), loadSummary(), loadCatalogue()]);
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e), errorField: apiErrorField(e));
      return false;
    }
  }

  /// Every income entry a given template has generated, oldest to newest —
  /// mirrors openTemplateHistory in IncomePanel.jsx. Doesn't touch
  /// state.income; this is its own read for the template's history screen.
  Future<List<IncomeEntry>> templateHistory(int templateId) async {
    try {
      return await usecase.income(recurringTemplateId: templateId);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e), errorField: apiErrorField(e));
      return const [];
    }
  }

  void clearError() => state = state.copyWith(clearError: true);
}
