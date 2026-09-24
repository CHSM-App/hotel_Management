import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'expense_combo_fields.dart';

/// Schedule or edit a recurring expense — its own full page rather than a
/// dialog, the same treatment [ExpenseFormScreen] and the room/asset forms
/// get, so every form in the app opens the same way.
Future<void> showRecurringTemplateFormScreen(BuildContext context, {RecurringTemplate? template}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => RecurringTemplateFormScreen(template: template)),
  );
}

class RecurringTemplateFormScreen extends ConsumerStatefulWidget {
  final RecurringTemplate? template;
  const RecurringTemplateFormScreen({super.key, this.template});

  @override
  ConsumerState<RecurringTemplateFormScreen> createState() => _RecurringTemplateFormScreenState();
}

class _RecurringTemplateFormScreenState extends ConsumerState<RecurringTemplateFormScreen> {
  bool get _isEdit => widget.template != null;

  late final _category = TextEditingController(text: widget.template?.categoryName ?? '');
  late final _vendor = TextEditingController(text: widget.template?.vendorName ?? '');
  String _frequency = 'MONTHLY';
  late final _title = TextEditingController(text: widget.template?.title ?? '');
  late final _amount = TextEditingController(text: widget.template?.amount == null ? '' : widget.template!.amount.toString());
  late final _nextDueDate = TextEditingController(text: widget.template?.nextDueDate ?? '');
  String? _error;

  @override
  void initState() {
    super.initState();
    _frequency = widget.template?.frequency ?? 'MONTHLY';
    Future.microtask(() => ref.read(expensesViewModelProvider.notifier).loadCatalogue());
  }

  @override
  void dispose() {
    _category.dispose();
    _vendor.dispose();
    _title.dispose();
    _amount.dispose();
    _nextDueDate.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: DateTime(now.year + 3),
      initialDate: DateTime.tryParse(_nextDueDate.text) ?? now,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      _nextDueDate.text = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    });
  }

  Future<void> _save() async {
    setState(() => _error = null);
    if (_category.text.trim().isEmpty) {
      setState(() => _error = 'Enter or choose a category.');
      return;
    }
    if (_title.text.trim().isEmpty) {
      setState(() => _error = 'Give this recurring expense a title.');
      return;
    }
    final amount = num.tryParse(_amount.text.trim());
    if (amount == null || amount < 0) {
      setState(() => _error = 'Enter a valid amount.');
      return;
    }
    if (_nextDueDate.text.trim().isEmpty) {
      setState(() => _error = 'Enter the next due date.');
      return;
    }
    final vm = ref.read(expensesViewModelProvider.notifier);
    int categoryId;
    int? vendorId;
    try {
      categoryId = await vm.resolveCategoryId(_category.text);
      vendorId = await vm.resolveVendorId(_vendor.text);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not save this template.');
      return;
    }
    final ok = await vm.saveTemplate({
      'categoryId': categoryId,
      'vendorId': vendorId,
      'title': _title.text.trim(),
      'amount': amount,
      'frequency': _frequency,
      'nextDueDate': _nextDueDate.text.trim(),
    }, id: widget.template?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(expensesViewModelProvider).error ?? 'Could not save this template.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(expensesViewModelProvider);
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit recurring expense' : 'New recurring expense')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_error != null) ...[
                    _ErrorBanner(_error!),
                    const SizedBox(height: AppTheme.s16),
                  ],

                  const SectionLabel('What repeats', number: 1),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _title, label: 'Title', hint: 'Rent, electricity, lift AMC…', required: true),
                  const SizedBox(height: AppTheme.s12),
                  CategoryComboField(
                    controller: _category,
                    options: {...state.categories.map((c) => c.name), ...kSuggestedExpenseCategories}.toList()..sort(),
                  ),
                  const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text("Pick from the list or type a new one — it's added the first time it's used.", style: TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  VendorComboField(controller: _vendor, vendors: state.vendors, label: 'Vendor'),

                  const SectionDivider(),
                  const SectionLabel('Amount & schedule', number: 2),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _amount, label: 'Amount', keyboardType: TextInputType.number, required: true),
                  const SizedBox(height: AppTheme.s12),
                  const RequiredLabel('Repeats'),
                  const SizedBox(height: AppTheme.s8),
                  OptionDropdown(
                    values: kFrequencies,
                    labels: kFrequencyLabel,
                    selected: _frequency,
                    onSelect: (v) => setState(() => _frequency = v),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _nextDueDate, label: 'Next due date', readOnly: true, onTap: _pickDate, required: true),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: state.submitting ? null : _save,
              child: state.submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  final String message;
  const _ErrorBanner(this.message);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
          const SizedBox(width: AppTheme.s8),
          Expanded(child: Text(message, style: const TextStyle(color: AppTheme.danger, fontSize: 13))),
        ],
      ),
    );
  }
}
