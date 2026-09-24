import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../../widgets/photo_source_sheet.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'expense_combo_fields.dart';

/// Log or edit a spend. Mirrors the expense form in ExpensesPanel.jsx.
Future<void> showExpenseFormSheet(BuildContext context, {Expense? expense}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => ExpenseFormScreen(expense: expense)),
  );
}

class ExpenseFormScreen extends ConsumerStatefulWidget {
  final Expense? expense;
  const ExpenseFormScreen({super.key, this.expense});

  @override
  ConsumerState<ExpenseFormScreen> createState() => _ExpenseFormScreenState();
}

class _ExpenseFormScreenState extends ConsumerState<ExpenseFormScreen> {
  bool get _isEdit => widget.expense != null;

  late final _category = TextEditingController(text: widget.expense?.categoryName ?? '');
  late final _vendor = TextEditingController(text: widget.expense?.vendorName ?? '');
  String _paymentMethod = 'CASH';
  late final _title = TextEditingController(text: widget.expense?.title ?? '');
  late final _description = TextEditingController(text: widget.expense?.description ?? '');
  late final _amount = TextEditingController(text: widget.expense?.amount == null ? '' : widget.expense!.amount.toString());
  late final _expenseDate = TextEditingController(
    text: widget.expense?.expenseDate ?? _isoToday(),
  );
  XFile? _billPhoto;
  String? _error;

  static String _isoToday() {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  @override
  void initState() {
    super.initState();
    _paymentMethod = widget.expense?.paymentMethod ?? 'CASH';
    Future.microtask(() => ref.read(expensesViewModelProvider.notifier).loadCatalogue());
  }

  @override
  void dispose() {
    _category.dispose();
    _vendor.dispose();
    _title.dispose();
    _description.dispose();
    _amount.dispose();
    _expenseDate.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final initial = DateTime.tryParse(_expenseDate.text) ?? now;
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 1),
      initialDate: initial,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      _expenseDate.text = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    });
  }

  Future<void> _pickBillPhoto() async {
    final source = await showPhotoSourceSheet(context, title: 'Add the receipt', subtitle: 'Take a photo or pick one from your gallery');
    if (source == null) return;
    final photo = await ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 1600);
    if (photo != null) setState(() => _billPhoto = photo);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(expensesViewModelProvider);
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit expense' : 'Log an expense')),
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

                  const SectionLabel('What was this for', number: 1),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _title, label: 'Title', hint: 'Electricity bill · August', required: true),
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
                  const SectionLabel('Amount & payment', number: 2),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _amount, label: 'Amount', keyboardType: TextInputType.number, required: true),
                  const SizedBox(height: AppTheme.s12),
                  const RequiredLabel('Paid via'),
                  const SizedBox(height: AppTheme.s8),
                  OptionDropdown(
                    values: kPaymentMethods,
                    labels: kPaymentMethodLabel,
                    selected: _paymentMethod,
                    onSelect: (v) => setState(() => _paymentMethod = v),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _expenseDate,
                    label: 'Date',
                    readOnly: true,
                    onTap: _pickDate,
                    required: true,
                  ),

                  const SectionDivider(),
                  const SectionLabel('Notes & receipt', number: 3),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _description, label: 'Notes', maxLength: 400),
                  const SizedBox(height: AppTheme.s16),
                  const Text('Receipt / bill (image or PDF)', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: AppTheme.s8),
                  Row(
                    children: [
                      if (_billPhoto != null)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(AppTheme.rSmall),
                          child: Image.file(File(_billPhoto!.path), width: 56, height: 56, fit: BoxFit.cover),
                        )
                      else if (_isEdit && widget.expense!.hasBillDocument)
                        Container(
                          width: 56,
                          height: 56,
                          decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(AppTheme.rSmall), border: Border.all(color: AppTheme.border)),
                          child: const Icon(Icons.receipt_long_rounded, color: AppTheme.muted),
                        ),
                      const SizedBox(width: AppTheme.s8),
                      NeuButton(onPressed: _pickBillPhoto, child: Text(_billPhoto == null ? 'Add photo' : 'Replace photo')),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: state.submitting ? null : _submit,
              child: state.submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(_isEdit ? 'Save changes' : 'Log expense'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    if (_category.text.trim().isEmpty) {
      setState(() => _error = 'Enter or choose a category.');
      return;
    }
    if (_title.text.trim().isEmpty) {
      setState(() => _error = 'Give this expense a title.');
      return;
    }
    final amount = num.tryParse(_amount.text.trim());
    if (amount == null || amount < 0) {
      setState(() => _error = 'Enter a valid amount.');
      return;
    }
    if (_expenseDate.text.trim().isEmpty) {
      setState(() => _error = 'Enter the expense date.');
      return;
    }

    final vm = ref.read(expensesViewModelProvider.notifier);
    int categoryId;
    int? vendorId;
    try {
      categoryId = await vm.resolveCategoryId(_category.text);
      vendorId = await vm.resolveVendorId(_vendor.text);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Could not save this expense.');
      return;
    }

    final formMap = <String, dynamic>{
      'categoryId': '$categoryId',
      'title': _title.text.trim(),
      'description': _description.text.trim(),
      'amount': amount.toString(),
      'paymentMethod': _paymentMethod,
      'expenseDate': _expenseDate.text.trim(),
      'vendorId': vendorId?.toString() ?? '',
    };
    if (_billPhoto != null) {
      formMap['bill'] = dio.MultipartFile.fromFileSync(_billPhoto!.path, filename: _billPhoto!.name);
    }
    final ok = await vm.saveExpense(dio.FormData.fromMap(formMap), id: widget.expense?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(expensesViewModelProvider).error ?? 'Could not save the expense.');
    }
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
