import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'expense_combo_fields.dart' show CategoryComboField;

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
  String _frequency = 'MONTHLY';
  late final _title = TextEditingController(text: widget.template?.title ?? '');
  late final _nextDueDate = TextEditingController(text: widget.template?.nextDueDate ?? '');
  String? _error;
  bool _submitAttempted = false;

  String? get _titleError =>
      (_submitAttempted && _title.text.trim().isEmpty) ? 'Give this recurring expense a title.' : null;
  String? get _categoryError =>
      (_submitAttempted && _category.text.trim().isEmpty) ? 'Enter or choose a category.' : null;

  String? get _dateError =>
      (_submitAttempted && _nextDueDate.text.trim().isEmpty) ? 'Enter the next due date.' : null;

  final _titleFieldKey = GlobalKey();
  final _categoryFieldKey = GlobalKey();
  final _dateFieldKey = GlobalKey();
  final _titleFocus = FocusNode();

  void _scrollToFirstError() {
    GlobalKey? key;
    FocusNode? focus;
    if (_titleError != null) {
      key = _titleFieldKey;
      focus = _titleFocus;
    } else if (_categoryError != null) {
      key = _categoryFieldKey;
    } else if (_dateError != null) {
      key = _dateFieldKey;
    }
    if (key == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = key!.currentContext;
      if (ctx != null) {
        Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 300), curve: Curves.easeOut, alignment: 0.15);
      }
      focus?.requestFocus();
    });
  }

  @override
  void initState() {
    super.initState();
    _frequency = widget.template?.frequency ?? 'MONTHLY';
    Future.microtask(() => ref.read(expensesViewModelProvider.notifier).loadCatalogue());
    _category.addListener(_onCategoryChanged);
  }

  void _onCategoryChanged() {
    if (_submitAttempted) setState(() {});
  }

  @override
  void dispose() {
    _category.removeListener(_onCategoryChanged);
    _category.dispose();
    _title.dispose();
    _nextDueDate.dispose();
    _titleFocus.dispose();
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
    setState(() {
      _error = null;
      _submitAttempted = true;
    });
    if (_titleError != null || _categoryError != null || _dateError != null) {
      _scrollToFirstError();
      return;
    }
    final vm = ref.read(expensesViewModelProvider.notifier);
    int categoryId;
    try {
      categoryId = await vm.resolveCategoryId(_category.text);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not save this template.');
      return;
    }
    final ok = await vm.saveTemplate({
      'categoryId': categoryId,
      'title': _title.text.trim(),
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
                  NeuField(
                    key: _titleFieldKey,
                    controller: _title,
                    label: 'Title',
                    hint: 'Rent, electricity, lift AMC…',
                    required: true,
                    errorText: _titleError,
                    focusNode: _titleFocus,
                    onChanged: (_) => setState(() {}),
                    forceCapitalizeWords: true,
                  ),
                  const SizedBox(height: AppTheme.s12),
                  CategoryComboField(
                    key: _categoryFieldKey,
                    controller: _category,
                    options: {...state.categories.map((c) => c.name), ...kSuggestedExpenseCategories}.toList()..sort(),
                    errorText: _categoryError,
                  ),
                  if (_categoryError == null)
                    const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: Text("Pick from the list or type a new one — it's added the first time it's used.", style: TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                    ),
                  const SectionDivider(),
                  const SectionLabel('Schedule', number: 2),
                  const SizedBox(height: AppTheme.s12),
                  const Text(
                    "How much and who gets paid are entered each time — \"Log this month\" records that occurrence once it's actually due.",
                    style: TextStyle(color: AppTheme.muted, fontSize: 11.5),
                  ),
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
                  NeuField(
                    key: _dateFieldKey,
                    controller: _nextDueDate,
                    label: 'Next due date',
                    readOnly: true,
                    onTap: _pickDate,
                    required: true,
                    errorText: _dateError,
                  ),
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
