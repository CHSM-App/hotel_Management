import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../domain/models/expense.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/photo_source_sheet.dart';
import '../bookings/id_proof_viewer_screen.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'expense_combo_fields.dart';

// Full option set for the payment-status dropdown — kPaymentStatusLabel
// (domain/models/expense.dart) deliberately omits PAID since it's only used
// for the "Partially paid"/"Pending" tags shown elsewhere.
const _paymentStatusOptionLabel = {'PAID': 'Paid in full', 'PARTIAL': 'Partially paid', 'PENDING': 'Pending'};

/// Log, view or edit a spend. Mirrors the expense form/detail modal in
/// ExpensesPanel.jsx: a row tap opens read-only first ([viewMode]), with an
/// "Edit details" action to switch the same screen into the editable form.
Future<void> showExpenseFormSheet(BuildContext context, {Expense? expense, bool viewMode = false}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => ExpenseFormScreen(expense: expense, viewMode: viewMode)),
  );
}

class ExpenseFormScreen extends ConsumerStatefulWidget {
  final Expense? expense;
  final bool viewMode;
  const ExpenseFormScreen({super.key, this.expense, this.viewMode = false});

  @override
  ConsumerState<ExpenseFormScreen> createState() => _ExpenseFormScreenState();
}

class _ExpenseFormScreenState extends ConsumerState<ExpenseFormScreen> {
  bool get _isEdit => widget.expense != null;
  // Always false for a brand-new expense — nothing to view yet. "Edit
  // details" flips this off to turn the same screen into the form.
  late bool _viewMode = widget.viewMode && _isEdit;

  late final _category = TextEditingController(text: widget.expense?.categoryName ?? '');
  late final _vendor = TextEditingController(text: widget.expense?.vendorName ?? '');
  String _paymentMethod = 'CASH';
  String _paymentStatus = 'PAID';
  late final _amountPaid = TextEditingController();
  late final _referenceNumber = TextEditingController();
  late final _title = TextEditingController(text: widget.expense?.title ?? '');
  late final _description = TextEditingController(text: widget.expense?.description ?? '');
  late final _amount = TextEditingController(text: widget.expense?.amount == null ? '' : widget.expense!.amount.toString());
  late final _expenseDate = TextEditingController(
    text: widget.expense?.expenseDate ?? _isoToday(),
  );
  XFile? _billPhoto;
  String? _error;
  // Set once Save is first pressed — before that, an empty required field
  // shouldn't shout at someone who hasn't gotten to it yet. Mirrors the same
  // flag in InventoryPanel's material form.
  bool _submitAttempted = false;

  String? get _titleError =>
      (_submitAttempted && _title.text.trim().isEmpty) ? 'Give this expense a title.' : null;
  String? get _categoryError =>
      (_submitAttempted && _category.text.trim().isEmpty) ? 'Enter or choose a category.' : null;
  String? get _amountError {
    if (!_submitAttempted) return null;
    final amount = num.tryParse(_amount.text.trim());
    return (amount == null || amount < 0) ? 'Enter a valid amount.' : null;
  }

  String? get _dateError =>
      (_submitAttempted && _expenseDate.text.trim().isEmpty) ? 'Enter the expense date.' : null;

  // Keyed so a failed Save can scroll straight to whichever required field
  // is empty — this form runs long enough that an error message left where
  // it was typed can sit off-screen, unseen, while the person keeps
  // re-pressing Save. Mirrors focusFirstError in ExpensesPanel.jsx, adapted
  // for a scrollable page instead of a modal.
  final _titleFieldKey = GlobalKey();
  final _categoryFieldKey = GlobalKey();
  final _amountFieldKey = GlobalKey();
  final _dateFieldKey = GlobalKey();
  final _titleFocus = FocusNode();
  final _amountFocus = FocusNode();

  void _scrollToFirstError() {
    GlobalKey? key;
    FocusNode? focus;
    if (_titleError != null) {
      key = _titleFieldKey;
      focus = _titleFocus;
    } else if (_categoryError != null) {
      key = _categoryFieldKey;
    } else if (_amountError != null) {
      key = _amountFieldKey;
      focus = _amountFocus;
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

  // ── Payments — mirrors the "Payments" section in ExpensesPanel.jsx. Only
  // meaningful once the expense exists; kept as running local state updated
  // from every add/delete response rather than re-fetching the expense.
  List<ExpensePayment> _payments = [];
  bool _loadingPayments = false;
  num _currentAmountPaid = 0;
  final _newPaymentAmount = TextEditingController();
  String _newPaymentMethod = 'CASH';
  late final _newPaymentDate = TextEditingController(text: _isoToday());
  final _newPaymentReference = TextEditingController();
  bool _addingPayment = false;
  String? _paymentError;

  static String _isoToday() {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  @override
  void initState() {
    super.initState();
    _paymentMethod = widget.expense?.paymentMethod ?? 'CASH';
    _paymentStatus = widget.expense?.paymentStatus ?? 'PAID';
    _currentAmountPaid = widget.expense?.amountPaid ?? 0;
    if (widget.expense?.amountPaid != null) {
      _amountPaid.text = widget.expense!.amountPaid.toString();
    }
    Future.microtask(() => ref.read(expensesViewModelProvider.notifier).loadCatalogue());
    if (_isEdit) _loadPayments();
    // CategoryComboField has no onChanged of its own — its error only clears
    // live (rather than waiting for the next Save press) if this screen
    // rebuilds when the shared controller's text changes.
    _category.addListener(_onCategoryChanged);
  }

  void _onCategoryChanged() {
    if (_submitAttempted) setState(() {});
  }

  Future<void> _loadPayments() async {
    setState(() => _loadingPayments = true);
    final payments = await ref.read(expensesViewModelProvider.notifier).loadPayments(widget.expense!.id);
    if (!mounted) return;
    setState(() {
      _payments = payments;
      _loadingPayments = false;
    });
  }

  @override
  void dispose() {
    _category.removeListener(_onCategoryChanged);
    _category.dispose();
    _vendor.dispose();
    _amountPaid.dispose();
    _referenceNumber.dispose();
    _title.dispose();
    _description.dispose();
    _amount.dispose();
    _expenseDate.dispose();
    _newPaymentAmount.dispose();
    _newPaymentDate.dispose();
    _newPaymentReference.dispose();
    _titleFocus.dispose();
    _amountFocus.dispose();
    super.dispose();
  }

  Future<void> _pickDate() => _pickDateInto(_expenseDate);

  Future<void> _pickDateInto(TextEditingController controller) async {
    final now = DateTime.now();
    final initial = DateTime.tryParse(controller.text) ?? now;
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
      controller.text = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    });
  }

  num get _remaining => (num.tryParse(_amount.text.trim()) ?? 0) - _currentAmountPaid;

  /// Logs a new payment against the already-saved expense — mirrors
  /// handleAddPayment in ExpensesPanel.jsx.
  Future<void> _addPayment() async {
    setState(() => _paymentError = null);
    final amount = num.tryParse(_newPaymentAmount.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _paymentError = 'Enter a valid amount.');
      return;
    }
    if (_newPaymentDate.text.trim().isEmpty) {
      setState(() => _paymentError = 'Enter when this was paid.');
      return;
    }

    setState(() => _addingPayment = true);
    final expense = await ref.read(expensesViewModelProvider.notifier).addPayment(widget.expense!.id, {
      'amount': amount.toString(),
      'paymentMethod': _newPaymentMethod,
      'referenceNumber': _newPaymentReference.text.trim(),
      'paidDate': _newPaymentDate.text.trim(),
    });
    if (!mounted) return;
    if (expense == null) {
      setState(() {
        _addingPayment = false;
        _paymentError = ref.read(expensesViewModelProvider).error ?? 'Could not add that payment.';
      });
      return;
    }
    _newPaymentAmount.clear();
    _newPaymentReference.clear();
    _newPaymentDate.text = _isoToday();
    setState(() {
      _addingPayment = false;
      _currentAmountPaid = expense.amountPaid ?? 0;
      _paymentStatus = expense.paymentStatus;
    });
    await _loadPayments();
  }

  Future<void> _deletePayment(ExpensePayment payment) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Remove this payment?', style: TextStyle(color: AppTheme.heading)),
        content: Text('${formatPrice(payment.amount)} · ${kPaymentMethodLabel[payment.paymentMethod] ?? payment.paymentMethod}', style: const TextStyle(color: AppTheme.text)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Remove', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (confirmed != true) return;
    final expense = await ref.read(expensesViewModelProvider.notifier).deletePayment(widget.expense!.id, payment.id);
    if (!mounted || expense == null) return;
    setState(() {
      _currentAmountPaid = expense.amountPaid ?? 0;
      _paymentStatus = expense.paymentStatus;
    });
    await _loadPayments();
  }

  void _viewBill(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => IdProofViewerScreen(
          title: 'Receipt · ${widget.expense!.title}',
          load: () async {
            final res = await ref.read(expensesViewModelProvider.notifier).usecase.expenseBill(widget.expense!.id);
            return (Uint8List.fromList(res.data!), res.headers.value('content-type'));
          },
        ),
      ),
    );
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
      appBar: AppBar(
        title: !_viewMode
            ? Text(_isEdit ? 'Edit expense' : 'Log an expense')
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(widget.expense!.title, overflow: TextOverflow.ellipsis),
                  Text(
                    [widget.expense!.categoryName, widget.expense!.vendorName].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w400),
                  ),
                ],
              ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            if (_viewMode) ...[
              // Read-only summary — a row tap lands here first, not in the
              // editable form. "Edit details" below switches this same
              // screen into the form. Mirrors the hero + facts layout of
              // AssetDetailScreen: a big headline amount up top, then the
              // rest as compact label/value rows in their own card.
              if (_error != null) ...[
                _ErrorBanner(_error!),
                const SizedBox(height: AppTheme.s12),
              ],
              _ExpenseHeroCard(expense: widget.expense!),
              const SizedBox(height: AppTheme.s12),
              NeuCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _ViewRow('Category', widget.expense!.categoryName),
                    if ((widget.expense!.vendorName ?? '').isNotEmpty) _ViewRow('Vendor', widget.expense!.vendorName!),
                    _ViewRow('Date', formatIsoDate(widget.expense!.expenseDate)),
                    if (widget.expense!.description.isNotEmpty) _ViewRow('Notes', widget.expense!.description),
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SizedBox(width: 110, child: Text('Receipt', style: TextStyle(color: AppTheme.muted, fontSize: 12.5))),
                          Expanded(
                            child: widget.expense!.hasBillDocument
                                ? GestureDetector(
                                    onTap: () => _viewBill(context),
                                    child: const Text('View receipt', style: TextStyle(color: AppTheme.accent, fontSize: 13, fontWeight: FontWeight.w600)),
                                  )
                                : const Text('Not uploaded', style: TextStyle(color: AppTheme.text, fontSize: 13)),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ] else
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
                    NeuField(
                      key: _titleFieldKey,
                      controller: _title,
                      label: 'Title',
                      hint: 'Electricity bill · August',
                      required: true,
                      errorText: _titleError,
                      focusNode: _titleFocus,
                      onChanged: (_) => setState(() {}),
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
                    const SizedBox(height: AppTheme.s12),
                    VendorComboField(controller: _vendor, vendors: state.vendors, label: 'Vendor'),

                    const SectionDivider(),
                    const SectionLabel('Amount & payment', number: 2),
                    const SizedBox(height: AppTheme.s12),
                    NeuField(
                      key: _amountFieldKey,
                      controller: _amount,
                      label: 'Amount',
                      keyboardType: TextInputType.number,
                      required: true,
                      errorText: _amountError,
                      focusNode: _amountFocus,
                      onChanged: (_) => setState(() {}),
                    ),
                    // Status/method/reference/amountPaid only make sense
                    // while logging a new expense — mirrors ExpensesPanel.jsx,
                    // where editing an existing one hides these in favour of
                    // the Payments section below (payment_method/status/
                    // amount_paid are never edited directly once payments
                    // exist).
                    if (!_isEdit) ...[
                      const SizedBox(height: AppTheme.s12),
                      const RequiredLabel('Payment status'),
                      const SizedBox(height: AppTheme.s8),
                      OptionDropdown(
                        values: kPaymentStatuses,
                        labels: _paymentStatusOptionLabel,
                        selected: _paymentStatus,
                        onSelect: (v) => setState(() => _paymentStatus = v),
                      ),
                      if (_paymentStatus != 'PENDING') ...[
                        const SizedBox(height: AppTheme.s12),
                        const RequiredLabel('Paid via'),
                        const SizedBox(height: AppTheme.s8),
                        OptionDropdown(
                          values: kPaymentMethods,
                          labels: kPaymentMethodLabel,
                          selected: _paymentMethod,
                          onSelect: (v) => setState(() => _paymentMethod = v),
                        ),
                        if (kPaymentReferenceLabel[_paymentMethod] != null) ...[
                          const SizedBox(height: AppTheme.s12),
                          NeuField(controller: _referenceNumber, label: kPaymentReferenceLabel[_paymentMethod]!),
                        ],
                      ],
                      if (_paymentStatus == 'PARTIAL') ...[
                        const SizedBox(height: AppTheme.s12),
                        NeuField(controller: _amountPaid, label: 'Amount paid so far', keyboardType: TextInputType.number),
                      ],
                    ],
                    const SizedBox(height: AppTheme.s12),
                    NeuField(
                      key: _dateFieldKey,
                      controller: _expenseDate,
                      label: 'Date',
                      readOnly: true,
                      onTap: _pickDate,
                      required: true,
                      errorText: _dateError,
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
            if (_isEdit) ...[
              const SizedBox(height: AppTheme.s16),
              _PaymentsSection(
                amount: num.tryParse(_amount.text.trim()) ?? 0,
                amountPaid: _currentAmountPaid,
                remaining: _remaining,
                payments: _payments,
                loading: _loadingPayments,
                onDeletePayment: _deletePayment,
                paymentError: _paymentError,
                newAmount: _newPaymentAmount,
                newMethod: _newPaymentMethod,
                newDate: _newPaymentDate,
                newReference: _newPaymentReference,
                addingPayment: _addingPayment,
                onMethodChanged: (v) => setState(() => _newPaymentMethod = v),
                onPickDate: () => _pickDateInto(_newPaymentDate),
                onAddPayment: _addPayment,
              ),
            ],
            const SizedBox(height: AppTheme.s24),
            if (_viewMode)
              Row(
                children: [
                  Expanded(
                    child: NeuButton(
                      expand: true,
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Close'),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s12),
                  Expanded(
                    child: NeuButton(
                      primary: true,
                      expand: true,
                      onPressed: () => setState(() => _viewMode = false),
                      child: const Text('Edit details'),
                    ),
                  ),
                ],
              )
            else
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
    setState(() {
      _error = null;
      _submitAttempted = true;
    });
    final amount = num.tryParse(_amount.text.trim());
    if (_titleError != null || _categoryError != null || _amountError != null || _dateError != null) {
      _scrollToFirstError();
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
      'amount': amount!.toString(),
      'paymentMethod': _paymentMethod,
      'paymentStatus': _paymentStatus,
      'amountPaid': _paymentStatus == 'PARTIAL' ? _amountPaid.text.trim() : '',
      'referenceNumber': _paymentStatus != 'PENDING' ? _referenceNumber.text.trim() : '',
      'expenseDate': _expenseDate.text.trim(),
      'vendorId': vendorId?.toString() ?? '',
    };
    if (_billPhoto != null) {
      formMap['billDocument'] = dio.MultipartFile.fromFileSync(_billPhoto!.path, filename: _billPhoto!.name);
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

/// One label/value pair in the read-only summary — same compact row shape
/// as AssetDetailScreen's `_FactsCard._fact`, so an expense's detail screen
/// reads as the same "facts card" as an asset's.
class _ViewRow extends StatelessWidget {
  final String label;
  final String value;
  const _ViewRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 110, child: Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 12.5))),
          Expanded(child: Text(value, style: const TextStyle(color: AppTheme.text, fontSize: 13))),
        ],
      ),
    );
  }
}

/// A stable, category-name-derived color and icon — the same visual
/// shorthand the Expenses list uses, carried onto this detail screen's hero
/// so a glance at the icon says "what kind of spend" before reading a word.
const _kCategoryPalette = [
  AppTheme.accent,
  AppTheme.edit,
  AppTheme.checkout,
  Color(0xFF9F7AEA),
  Color(0xFF38A169),
  Color(0xFFD53F8C),
];

Color _categoryColor(String name) => _kCategoryPalette[name.codeUnits.fold<int>(0, (a, b) => a + b) % _kCategoryPalette.length];

/// The headline card at the top of the read-only view — big amount, a
/// colored category badge, and the payment-status pill, mirroring the
/// prominence AssetDetailScreen gives status at the top of its own detail
/// screen instead of burying it in a label/value row.
class _ExpenseHeroCard extends StatelessWidget {
  final Expense expense;
  const _ExpenseHeroCard({required this.expense});

  @override
  Widget build(BuildContext context) {
    final color = _categoryColor(expense.categoryName);
    final statusLabel = kPaymentStatusLabel[expense.paymentStatus];
    return NeuCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppTheme.rMedium)),
            child: Icon(Icons.receipt_long_rounded, size: 22, color: color),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(formatPrice(expense.amount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 24)),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        expense.paymentStatus == 'PENDING'
                            ? formatIsoDate(expense.expenseDate)
                            : '${formatIsoDate(expense.expenseDate)} · ${kPaymentMethodLabel[expense.paymentMethod] ?? expense.paymentMethod}',
                        style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (statusLabel != null) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                        decoration: BoxDecoration(
                          color: (expense.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          statusLabel,
                          style: TextStyle(
                            color: expense.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout,
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// "Payments" — mirrors AssetDetailScreen's `_PurchasePaymentsSection`: a
/// running total/remaining, the payment list in its own card, and a mini
/// add-payment form below it once anything is still owed. Shown for both the
/// read-only view and the edit form, same as before.
class _PaymentsSection extends StatelessWidget {
  final num amount;
  final num amountPaid;
  final num remaining;
  final List<ExpensePayment> payments;
  final bool loading;
  final ValueChanged<ExpensePayment> onDeletePayment;
  final String? paymentError;
  final TextEditingController newAmount;
  final String newMethod;
  final TextEditingController newDate;
  final TextEditingController newReference;
  final bool addingPayment;
  final ValueChanged<String> onMethodChanged;
  final VoidCallback onPickDate;
  final VoidCallback onAddPayment;

  const _PaymentsSection({
    required this.amount,
    required this.amountPaid,
    required this.remaining,
    required this.payments,
    required this.loading,
    required this.onDeletePayment,
    required this.paymentError,
    required this.newAmount,
    required this.newMethod,
    required this.newDate,
    required this.newReference,
    required this.addingPayment,
    required this.onMethodChanged,
    required this.onPickDate,
    required this.onAddPayment,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Payments', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
        const SizedBox(height: 4),
        Text(
          '${formatPrice(amountPaid)} of ${formatPrice(amount)} paid${remaining > 0.01 ? ' · ${formatPrice(remaining)} left' : ''}',
          style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
        ),
        const SizedBox(height: AppTheme.s8),
        if (loading)
          const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
        else ...[
          if (payments.isNotEmpty)
            NeuCard(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                children: [
                  for (final p in payments)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: AppTheme.s4),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${formatPrice(p.amount)} · ${kPaymentMethodLabel[p.paymentMethod] ?? p.paymentMethod}',
                                  style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  [
                                    formatIsoDate(p.paidDate),
                                    if (p.referenceNumber != null && p.referenceNumber!.isNotEmpty)
                                      '${kPaymentReferenceLabel[p.paymentMethod] ?? 'Ref'}: ${p.referenceNumber}',
                                  ].join(' · '),
                                  style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(Icons.delete_outline_rounded, size: 18, color: AppTheme.danger),
                            onPressed: () => onDeletePayment(p),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          if (paymentError != null) ...[
            const SizedBox(height: AppTheme.s8),
            _ErrorBanner(paymentError!),
          ],
          if (remaining > 0.01) ...[
            const SizedBox(height: AppTheme.s12),
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Add a payment against what's left", style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: newAmount, label: 'Amount', keyboardType: TextInputType.number),
                  const SizedBox(height: AppTheme.s12),
                  OptionDropdown(
                    values: kPaymentMethods,
                    labels: kPaymentMethodLabel,
                    selected: newMethod,
                    onSelect: onMethodChanged,
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: newDate, label: 'Date', readOnly: true, onTap: onPickDate),
                  if (kPaymentReferenceLabel[newMethod] != null) ...[
                    const SizedBox(height: AppTheme.s12),
                    NeuField(controller: newReference, label: kPaymentReferenceLabel[newMethod]!),
                  ],
                  const SizedBox(height: AppTheme.s12),
                  NeuButton(
                    expand: true,
                    onPressed: addingPayment ? null : onAddPayment,
                    child: addingPayment
                        ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Add payment'),
                  ),
                ],
              ),
            ),
          ],
        ],
      ],
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
