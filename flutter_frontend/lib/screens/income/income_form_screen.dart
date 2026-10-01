import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../domain/models/asset.dart' show Vendor;
import '../../domain/models/income.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/photo_source_sheet.dart';
import '../bookings/id_proof_viewer_screen.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'income_combo_fields.dart';

// Full option set for the payment-status dropdown — kIncomeStatusLabel
// (domain/models/income.dart) deliberately omits PAID since it's only used
// for the "Partially received"/"Pending" tags shown elsewhere.
const _paymentStatusOptionLabel = {'PAID': 'Received in full', 'PARTIAL': 'Partially received', 'PENDING': 'Pending'};

/// Log, view or edit a receipt of other income. Mirrors the income form/detail
/// modal in IncomePanel.jsx: a row tap opens read-only first ([viewMode]),
/// with an "Edit details" action to switch the same screen into the editable
/// form.
Future<void> showIncomeFormSheet(BuildContext context, {IncomeEntry? income, bool viewMode = false}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => IncomeFormScreen(income: income, viewMode: viewMode)),
  );
}

/// "Log this month" — opens this same form pre-filled from a recurring
/// template (category, payer, title, due date), amount left blank for the
/// desk to type. Submitting posts to /income/recurring/:id/log instead of the
/// plain create endpoint — mirrors openOccurrenceForm in IncomePanel.jsx.
Future<void> showLogIncomeOccurrenceFormSheet(BuildContext context, {required IncomeRecurringTemplate template}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => IncomeFormScreen(loggingTemplate: template)),
  );
}

/// "+ Add interest voucher" — opens the same form pre-filled with the
/// Interest Earned category, a "Bank interest" title and Bank transfer as the
/// payment method, same as openInterestVoucher in IncomePanel.jsx.
Future<void> showInterestVoucherFormSheet(BuildContext context) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => const IncomeFormScreen(interestVoucher: true)),
  );
}

class IncomeFormScreen extends ConsumerStatefulWidget {
  final IncomeEntry? income;
  final bool viewMode;
  final IncomeRecurringTemplate? loggingTemplate;
  final bool interestVoucher;
  const IncomeFormScreen({super.key, this.income, this.viewMode = false, this.loggingTemplate, this.interestVoucher = false});

  @override
  ConsumerState<IncomeFormScreen> createState() => _IncomeFormScreenState();
}

class _IncomeFormScreenState extends ConsumerState<IncomeFormScreen> {
  bool get _isEdit => widget.income != null;
  bool get _isLogging => widget.loggingTemplate != null;
  // Always false for a brand-new entry — nothing to view yet. "Edit details"
  // flips this off to turn the same screen into the form.
  late bool _viewMode = widget.viewMode && _isEdit;

  late final _category = TextEditingController(
    text: widget.income?.categoryName ?? widget.loggingTemplate?.categoryName ?? (widget.interestVoucher ? kInterestIncomeCategory : ''),
  );
  late final _payer = TextEditingController(text: widget.income?.payerName ?? widget.loggingTemplate?.payerName ?? '');
  // Payer sub-fields — auto-filled from the picked payer's own record
  // (mirrors payerContactPerson/payerPhone/payerEmail/payerSpecialty in
  // IncomePanel.jsx's emptyIncomeForm), or typed fresh when the payer is
  // new. Each maps to its own matching field on Vendor — name → _payer,
  // contactPerson → _payerContactPerson, phone → _payerPhone, email →
  // _payerEmail, specialty → _payerSpecialty — never cross-assigned.
  final _payerContactPerson = TextEditingController();
  final _payerPhone = TextEditingController();
  final _payerEmail = TextEditingController();
  final _payerSpecialty = TextEditingController();
  // Set only by an actual pick from the suggestion list (never by typing) —
  // resolvePayerId uses this to skip re-creating a payer that already
  // exists. Cleared the moment the typed name no longer matches that pick.
  int? _payerId;
  String _paymentMethod = 'CASH';
  String _paymentStatus = 'PAID';
  late final _amountReceived = TextEditingController();
  late final _referenceNumber = TextEditingController();
  late final _title = TextEditingController(
    text: widget.income?.title ?? widget.loggingTemplate?.title ?? (widget.interestVoucher ? 'Bank interest' : ''),
  );
  late final _description = TextEditingController(text: widget.income?.description ?? '');
  late final _amount = TextEditingController(text: widget.income?.amount == null ? '' : widget.income!.amount.toString());
  late final _incomeDate = TextEditingController(
    text: widget.income?.incomeDate ?? widget.loggingTemplate?.nextDueDate ?? _isoToday(),
  );
  XFile? _receiptPhoto;
  String? _error;
  // Set once Save is first pressed — before that, an empty required field
  // shouldn't shout at someone who hasn't gotten to it yet.
  bool _submitAttempted = false;

  String? get _titleError =>
      (_submitAttempted && _title.text.trim().isEmpty) ? 'Give this income a title.' : null;
  String? get _categoryError =>
      (_submitAttempted && _category.text.trim().isEmpty) ? 'Enter or choose a category.' : null;
  String? get _amountError {
    if (!_submitAttempted) return null;
    final amount = num.tryParse(_amount.text.trim());
    return (amount == null || amount < 0) ? 'Enter a valid amount.' : null;
  }

  String? get _dateError =>
      (_submitAttempted && _incomeDate.text.trim().isEmpty) ? 'Enter the income date.' : null;

  // Keyed so a failed Save can scroll straight to whichever required field
  // is empty — mirrors focusFirstError in IncomePanel.jsx, adapted for a
  // scrollable page instead of a modal.
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

  // ── Receipts — mirrors the "Receipts" section in IncomePanel.jsx. Only
  // meaningful once the income entry exists; kept as running local state
  // updated from every add/delete response rather than re-fetching the entry.
  List<IncomeReceipt> _receipts = [];
  bool _loadingReceipts = false;
  num _currentAmountReceived = 0;
  final _newReceiptAmount = TextEditingController();
  String _newReceiptMethod = 'CASH';
  late final _newReceiptDate = TextEditingController(text: _isoToday());
  final _newReceiptReference = TextEditingController();
  bool _addingReceipt = false;
  String? _receiptError;

  static String _isoToday() {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  @override
  void initState() {
    super.initState();
    _paymentMethod = widget.income?.paymentMethod ?? (widget.interestVoucher ? 'BANK_TRANSFER' : 'CASH');
    _paymentStatus = widget.income?.paymentStatus ?? 'PAID';
    _currentAmountReceived = widget.income?.amountReceived ?? 0;
    if (widget.income?.amountReceived != null) {
      _amountReceived.text = widget.income!.amountReceived.toString();
    }
    _payerId = widget.income?.payerId ?? widget.loggingTemplate?.payerId;
    Future.microtask(() async {
      await ref.read(incomeViewModelProvider.notifier).loadCatalogue();
      if (!mounted) return;
      _prefillPayerFieldsFromRoster();
    });
    if (_isEdit) _loadReceipts();
    // IncomeCategoryComboField has no onChanged of its own — its error only
    // clears live (rather than waiting for the next Save press) if this
    // screen rebuilds when the shared controller's text changes.
    _category.addListener(_onCategoryChanged);
    // Typing over a picked payer's name invalidates the pick — mirrors
    // onChange clearing payerId in IncomePanel.jsx's PayerField. Only an
    // actual re-pick (via PayerComboField.onPick) sets _payerId again.
    _payer.addListener(_onPayerNameEdited);
  }

  void _onCategoryChanged() {
    if (_submitAttempted) setState(() {});
  }

  /// Looks up the already-known payer (from editing an entry, or "Log this
  /// month" carrying one over from its template) in the now-loaded payer
  /// roster and fills in their contact fields — mirrors openIncomeForm's
  /// freshPayers.find in IncomePanel.jsx. Each Vendor field lands in its own
  /// matching controller: name → _payer (already set), contactPerson →
  /// _payerContactPerson, phone → _payerPhone, email → _payerEmail,
  /// specialty → _payerSpecialty.
  void _prefillPayerFieldsFromRoster() {
    if (_payerId == null) return;
    final state = ref.read(incomeViewModelProvider);
    Vendor? match;
    for (final p in state.payers) {
      if (p.id == _payerId) {
        match = p;
        break;
      }
    }
    if (match == null) return;
    setState(() {
      _payerContactPerson.text = match!.contactPerson;
      _payerPhone.text = match.phone;
      _payerEmail.text = match.email;
      _payerSpecialty.text = match.specialty;
    });
  }

  /// Fires on every keystroke in the payer name field — rebuilds so the
  /// contact sub-fields show/hide as the field goes empty/non-empty, and
  /// clears a stale pick: once the typed name no longer matches the payer
  /// that _payerId points to (which only happens once the desk starts typing
  /// over what they picked), a fresh payer gets created on save instead.
  void _onPayerNameEdited() {
    if (_payerId != null) {
      final state = ref.read(incomeViewModelProvider);
      final stillMatches = state.payers.any((p) => p.id == _payerId && p.name == _payer.text);
      if (!stillMatches) _payerId = null;
    }
    setState(() {});
  }

  /// The whole point of [PayerComboField.onPick]: hands back the full
  /// [Vendor] so every one of its fields can be copied into its own matching
  /// controller — never cross-assigned (contactPerson only ever goes into
  /// _payerContactPerson, email only ever into _payerEmail, etc).
  void _onPayerPicked(Vendor payer) {
    setState(() {
      _payerId = payer.id;
      _payerContactPerson.text = payer.contactPerson;
      _payerPhone.text = payer.phone;
      _payerEmail.text = payer.email;
      _payerSpecialty.text = payer.specialty;
    });
  }

  Future<void> _loadReceipts() async {
    setState(() => _loadingReceipts = true);
    final receipts = await ref.read(incomeViewModelProvider.notifier).loadReceipts(widget.income!.id);
    if (!mounted) return;
    setState(() {
      _receipts = receipts;
      _loadingReceipts = false;
    });
  }

  @override
  void dispose() {
    _category.removeListener(_onCategoryChanged);
    _category.dispose();
    _payer.removeListener(_onPayerNameEdited);
    _payer.dispose();
    _payerContactPerson.dispose();
    _payerPhone.dispose();
    _payerEmail.dispose();
    _payerSpecialty.dispose();
    _amountReceived.dispose();
    _referenceNumber.dispose();
    _title.dispose();
    _description.dispose();
    _amount.dispose();
    _incomeDate.dispose();
    _newReceiptAmount.dispose();
    _newReceiptDate.dispose();
    _newReceiptReference.dispose();
    _titleFocus.dispose();
    _amountFocus.dispose();
    super.dispose();
  }

  Future<void> _pickDate() => _pickDateInto(_incomeDate);

  Future<void> _pickDateInto(TextEditingController controller) async {
    final now = DateTime.now();
    final initial = DateTime.tryParse(controller.text) ?? now;
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: now,
      initialDate: initial.isAfter(now) ? now : initial,
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

  num get _remaining => (num.tryParse(_amount.text.trim()) ?? 0) - _currentAmountReceived;

  /// Logs a new receipt against the already-saved income entry — mirrors
  /// handleAddReceipt in IncomePanel.jsx.
  Future<void> _addReceipt() async {
    setState(() => _receiptError = null);
    final amount = num.tryParse(_newReceiptAmount.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _receiptError = 'Enter a valid amount.');
      return;
    }
    if (_newReceiptDate.text.trim().isEmpty) {
      setState(() => _receiptError = 'Enter when this was received.');
      return;
    }

    setState(() => _addingReceipt = true);
    final entry = await ref.read(incomeViewModelProvider.notifier).addReceipt(widget.income!.id, {
      'amount': amount.toString(),
      'paymentMethod': _newReceiptMethod,
      'referenceNumber': _newReceiptReference.text.trim(),
      'receivedDate': _newReceiptDate.text.trim(),
    });
    if (!mounted) return;
    if (entry == null) {
      setState(() {
        _addingReceipt = false;
        _receiptError = ref.read(incomeViewModelProvider).error ?? 'Could not add that receipt.';
      });
      return;
    }
    _newReceiptAmount.clear();
    _newReceiptReference.clear();
    _newReceiptDate.text = _isoToday();
    setState(() {
      _addingReceipt = false;
      _currentAmountReceived = entry.amountReceived ?? 0;
      _paymentStatus = entry.paymentStatus;
    });
    await _loadReceipts();
  }

  Future<void> _deleteReceipt(IncomeReceipt receipt) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Remove this receipt?', style: TextStyle(color: AppTheme.heading)),
        content: Text('${formatPrice(receipt.amount)} · ${kPaymentMethodLabel[receipt.paymentMethod] ?? receipt.paymentMethod}', style: const TextStyle(color: AppTheme.text)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Remove', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (confirmed != true) return;
    final entry = await ref.read(incomeViewModelProvider.notifier).deleteReceipt(widget.income!.id, receipt.id);
    if (!mounted || entry == null) return;
    setState(() {
      _currentAmountReceived = entry.amountReceived ?? 0;
      _paymentStatus = entry.paymentStatus;
    });
    await _loadReceipts();
  }

  void _viewReceiptDocument(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => IdProofViewerScreen(
          title: 'Receipt · ${widget.income!.title}',
          load: () async {
            final res = await ref.read(incomeViewModelProvider.notifier).usecase.incomeReceiptFile(widget.income!.id);
            return (Uint8List.fromList(res.data!), res.headers.value('content-type'));
          },
        ),
      ),
    );
  }

  Future<void> _pickReceiptPhoto() async {
    final source = await showPhotoSourceSheet(context, title: 'Add the receipt', subtitle: 'Take a photo or pick one from your gallery');
    if (source == null) return;
    final photo = await ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 1600);
    if (photo != null) setState(() => _receiptPhoto = photo);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(incomeViewModelProvider);
    return Scaffold(
      appBar: AppBar(
        title: !_viewMode
            ? Text(_isEdit ? 'Edit income' : (_isLogging ? 'Log this month' : 'New income'))
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(widget.income!.title, overflow: TextOverflow.ellipsis),
                  Text(
                    [widget.income!.categoryName, widget.income!.payerName].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
                    style: Theme.of(context).textTheme.bodySmall,
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
              // screen into the form.
              if (_error != null) ...[
                _ErrorBanner(_error!),
                const SizedBox(height: AppTheme.s12),
              ],
              _IncomeHeroCard(income: widget.income!),
              const SizedBox(height: AppTheme.s12),
              NeuCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _ViewRow('Category', widget.income!.categoryName),
                    if ((widget.income!.payerName ?? '').isNotEmpty) _ViewRow('Payer', widget.income!.payerName!),
                    _ViewRow('Date', formatIsoDate(widget.income!.incomeDate)),
                    if (widget.income!.description.isNotEmpty) _ViewRow('Notes', widget.income!.description),
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SizedBox(width: 110, child: Text('Receipt', style: TextStyle(color: AppTheme.muted, fontSize: 12.5))),
                          Expanded(
                            child: widget.income!.hasReceiptDocument
                                ? GestureDetector(
                                    onTap: () => _viewReceiptDocument(context),
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
                      hint: 'Interest credited, scrap sale, shop rent…',
                      required: true,
                      errorText: _titleError,
                      focusNode: _titleFocus,
                      onChanged: (_) => setState(() {}),
                      forceCapitalizeWords: true,
                    ),
                    const SizedBox(height: AppTheme.s12),
                    IncomeCategoryComboField(
                      key: _categoryFieldKey,
                      controller: _category,
                      options: {...state.categories.map((c) => c.name), ...kSuggestedIncomeCategories}.toList()..sort(),
                      errorText: _categoryError,
                    ),
                    if (_categoryError == null)
                      const Padding(
                        padding: EdgeInsets.only(top: 4),
                        child: Text("Pick from the list or type a new one — it's added the first time it's used.", style: TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                      ),
                    const SizedBox(height: AppTheme.s12),
                    PayerComboField(controller: _payer, payers: state.payers, label: 'Payer', onPick: _onPayerPicked),
                    if (_payer.text.trim().isNotEmpty) ...[
                      const SizedBox(height: AppTheme.s12),
                      NeuField(controller: _payerContactPerson, label: 'Payer contact person', forceCapitalizeWords: true),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(controller: _payerPhone, label: 'Payer phone', keyboardType: TextInputType.phone),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(controller: _payerEmail, label: 'Payer email', keyboardType: TextInputType.emailAddress),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(controller: _payerSpecialty, label: 'Payer specialty', hint: 'Shop tenant, event partner…'),
                    ],

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
                    // Status/method/reference/amountReceived only make sense
                    // while logging a new income entry — mirrors
                    // IncomePanel.jsx, where editing an existing one hides
                    // these in favour of the Receipts section below.
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
                        const RequiredLabel('Received via'),
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
                        NeuField(controller: _amountReceived, label: 'Amount received so far', keyboardType: TextInputType.number),
                      ],
                    ],
                    const SizedBox(height: AppTheme.s12),
                    NeuField(
                      key: _dateFieldKey,
                      controller: _incomeDate,
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
                    Text('Receipt / proof (image or PDF)', style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: AppTheme.s8),
                    Row(
                      children: [
                        if (_receiptPhoto != null)
                          ClipRRect(
                            borderRadius: BorderRadius.circular(AppTheme.rSmall),
                            child: Image.file(File(_receiptPhoto!.path), width: 56, height: 56, fit: BoxFit.cover),
                          )
                        else if (_isEdit && widget.income!.hasReceiptDocument)
                          Container(
                            width: 56,
                            height: 56,
                            decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(AppTheme.rSmall), border: Border.all(color: AppTheme.border)),
                            child: const Icon(Icons.receipt_long_rounded, color: AppTheme.muted),
                          ),
                        const SizedBox(width: AppTheme.s8),
                        NeuButton(onPressed: _pickReceiptPhoto, child: Text(_receiptPhoto == null ? 'Add photo' : 'Replace photo')),
                      ],
                    ),
                  ],
                ),
              ),
            if (_isEdit) ...[
              const SizedBox(height: AppTheme.s16),
              _ReceiptsSection(
                amount: num.tryParse(_amount.text.trim()) ?? 0,
                amountReceived: _currentAmountReceived,
                remaining: _remaining,
                receipts: _receipts,
                loading: _loadingReceipts,
                onDeleteReceipt: _deleteReceipt,
                receiptError: _receiptError,
                newAmount: _newReceiptAmount,
                newMethod: _newReceiptMethod,
                newDate: _newReceiptDate,
                newReference: _newReceiptReference,
                addingReceipt: _addingReceipt,
                onMethodChanged: (v) => setState(() => _newReceiptMethod = v),
                onPickDate: () => _pickDateInto(_newReceiptDate),
                onAddReceipt: _addReceipt,
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
                    : Text(_isEdit ? 'Save changes' : (_isLogging ? 'Log this occurrence' : 'Log income')),
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

    final vm = ref.read(incomeViewModelProvider.notifier);
    int categoryId;
    int? payerId;
    try {
      categoryId = await vm.resolveCategoryId(_category.text);
      // Each Vendor field goes to its own matching form field — name is
      // resolved by resolvePayerId itself; contactPerson/phone/email/
      // specialty ride along only for a brand-new payer (pickedId == null),
      // same as resolvePayerId's POST body in IncomePanel.jsx.
      payerId = await vm.resolvePayerId(
        _payer.text,
        pickedId: _payerId,
        extra: {
          'contactPerson': _payerContactPerson.text.trim(),
          'phone': _payerPhone.text.trim(),
          'email': _payerEmail.text.trim(),
          'specialty': _payerSpecialty.text.trim(),
        },
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Could not save this income entry.');
      return;
    }

    final formMap = <String, dynamic>{
      'categoryId': '$categoryId',
      'title': _title.text.trim(),
      'description': _description.text.trim(),
      'amount': amount!.toString(),
      'paymentMethod': _paymentMethod,
      'paymentStatus': _paymentStatus,
      'amountReceived': _paymentStatus == 'PARTIAL' ? _amountReceived.text.trim() : '',
      'referenceNumber': _paymentStatus != 'PENDING' ? _referenceNumber.text.trim() : '',
      'incomeDate': _incomeDate.text.trim(),
      'payerId': payerId?.toString() ?? '',
    };
    if (_receiptPhoto != null) {
      formMap['receiptDocument'] = dio.MultipartFile.fromFileSync(_receiptPhoto!.path, filename: _receiptPhoto!.name);
    }
    final form = dio.FormData.fromMap(formMap);
    final ok = _isLogging
        ? await vm.logOccurrence(widget.loggingTemplate!.id, form)
        : await vm.saveIncome(form, id: widget.income?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(incomeViewModelProvider).error ?? 'Could not save this income entry.');
    }
  }
}

/// One label/value pair in the read-only summary.
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
/// shorthand the Income list uses, carried onto this detail screen's hero.
const _kCategoryPalette = [
  AppTheme.vacant,
  AppTheme.accent,
  AppTheme.checkedIn,
  Color(0xFF9F7AEA),
  Color(0xFF38A169),
  Color(0xFFD53F8C),
];

Color _categoryColor(String name) => _kCategoryPalette[name.codeUnits.fold<int>(0, (a, b) => a + b) % _kCategoryPalette.length];

/// The headline card at the top of the read-only view — big amount, a
/// colored category badge, and the payment-status pill.
class _IncomeHeroCard extends StatelessWidget {
  final IncomeEntry income;
  const _IncomeHeroCard({required this.income});

  @override
  Widget build(BuildContext context) {
    final color = _categoryColor(income.categoryName);
    final statusLabel = kIncomeStatusLabel[income.paymentStatus];
    return NeuCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppTheme.rMedium)),
            child: Icon(Icons.savings_rounded, size: 22, color: color),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(formatPrice(income.amount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 24)),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        income.paymentStatus == 'PENDING'
                            ? formatIsoDate(income.incomeDate)
                            : '${formatIsoDate(income.incomeDate)} · ${kPaymentMethodLabel[income.paymentMethod] ?? income.paymentMethod}',
                        style: Theme.of(context).textTheme.bodySmall,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (statusLabel != null) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                        decoration: BoxDecoration(
                          color: (income.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout).withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          statusLabel,
                          style: TextStyle(
                            color: income.paymentStatus == 'PENDING' ? AppTheme.danger : AppTheme.checkout,
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

/// "Receipts" — a running total/remaining, the receipt list in its own card,
/// and a mini add-receipt form below it once anything is still due. Shown
/// only once the income entry exists, mirroring [_PaymentsSection] in
/// expense_form_screen.dart.
class _ReceiptsSection extends StatelessWidget {
  final num amount;
  final num amountReceived;
  final num remaining;
  final List<IncomeReceipt> receipts;
  final bool loading;
  final ValueChanged<IncomeReceipt> onDeleteReceipt;
  final String? receiptError;
  final TextEditingController newAmount;
  final String newMethod;
  final TextEditingController newDate;
  final TextEditingController newReference;
  final bool addingReceipt;
  final ValueChanged<String> onMethodChanged;
  final VoidCallback onPickDate;
  final VoidCallback onAddReceipt;

  const _ReceiptsSection({
    required this.amount,
    required this.amountReceived,
    required this.remaining,
    required this.receipts,
    required this.loading,
    required this.onDeleteReceipt,
    required this.receiptError,
    required this.newAmount,
    required this.newMethod,
    required this.newDate,
    required this.newReference,
    required this.addingReceipt,
    required this.onMethodChanged,
    required this.onPickDate,
    required this.onAddReceipt,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Receipts', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
        const SizedBox(height: 4),
        Text(
          '${formatPrice(amountReceived)} of ${formatPrice(amount)} received${remaining > 0.01 ? ' · ${formatPrice(remaining)} left' : ''}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: AppTheme.s8),
        if (loading)
          const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
        else ...[
          if (receipts.isNotEmpty)
            NeuCard(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                children: [
                  for (final r in receipts)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: AppTheme.s4),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${formatPrice(r.amount)} · ${kPaymentMethodLabel[r.paymentMethod] ?? r.paymentMethod}',
                                  style: Theme.of(context).textTheme.titleSmall,
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  [
                                    formatIsoDate(r.receivedDate),
                                    if (r.referenceNumber != null && r.referenceNumber!.isNotEmpty)
                                      '${kPaymentReferenceLabel[r.paymentMethod] ?? 'Ref'}: ${r.referenceNumber}',
                                  ].join(' · '),
                                  style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(Icons.delete_outline_rounded, size: 18, color: AppTheme.danger),
                            onPressed: () => onDeleteReceipt(r),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          if (receiptError != null) ...[
            const SizedBox(height: AppTheme.s8),
            _ErrorBanner(receiptError!),
          ],
          if (remaining > 0.01) ...[
            const SizedBox(height: AppTheme.s12),
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text("Add a receipt against what's left", style: Theme.of(context).textTheme.bodySmall),
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
                    onPressed: addingReceipt ? null : onAddReceipt,
                    child: addingReceipt
                        ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Add receipt'),
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
