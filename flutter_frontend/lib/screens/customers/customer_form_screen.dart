import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/form_feedback.dart';
import '../../domain/models/customer.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Add or edit a customer — its own full page, same treatment every other
/// form in the app gets rather than a dialog. Mirrors the add/edit mode of
/// Customers.jsx's own profile modal: phone is the match key per lodge and
/// cannot be changed once the customer exists.
Future<void> showCustomerFormScreen(BuildContext context, {Customer? customer}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => CustomerFormScreen(customer: customer)),
  );
}

class CustomerFormScreen extends ConsumerStatefulWidget {
  final Customer? customer;
  const CustomerFormScreen({super.key, this.customer});

  @override
  ConsumerState<CustomerFormScreen> createState() => _CustomerFormScreenState();
}

class _CustomerFormScreenState extends ConsumerState<CustomerFormScreen> {
  bool get _isEdit => widget.customer != null;

  late final _name = TextEditingController(text: widget.customer?.name ?? '');
  late final _phone = TextEditingController(text: widget.customer?.phone ?? '');
  late final _email = TextEditingController(text: widget.customer?.email ?? '');
  late final _tags = TextEditingController(text: widget.customer?.tags ?? '');
  late final _notes = TextEditingController(text: widget.customer?.notes ?? '');
  late final _idProofType = TextEditingController(text: widget.customer?.idProofType ?? '');
  late final _idProofNumber = TextEditingController(text: widget.customer?.idProofNumber ?? '');
  late bool _marketingOptIn = widget.customer?.marketingOptIn ?? false;
  String? _error;
  bool _submitAttempted = false;

  final _nameFocus = FocusNode();
  final _phoneFocus = FocusNode();
  final _emailFocus = FocusNode();

  static final _phoneTen = RegExp(r'^[6-9]\d{9}$');
  static final _emailFormat = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

  String? get _nameError =>
      (_submitAttempted && _name.text.trim().isEmpty) ? 'Enter a name.' : null;

  String? get _phoneError {
    if (_isEdit || !_submitAttempted) return null;
    if (_phone.text.trim().isEmpty) return 'Enter a phone number.';
    if (!_phoneTen.hasMatch(_phone.text.trim())) {
      return 'Enter a valid 10-digit mobile number (starting 6-9).';
    }
    return null;
  }

  String? get _emailError {
    if (_email.text.trim().isEmpty) return null;
    if (!_emailFormat.hasMatch(_email.text.trim())) return 'Enter a valid email.';
    return null;
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _email.dispose();
    _tags.dispose();
    _notes.dispose();
    _idProofType.dispose();
    _idProofNumber.dispose();
    _nameFocus.dispose();
    _phoneFocus.dispose();
    _emailFocus.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _error = null;
      _submitAttempted = true;
    });
    if (_nameError != null) {
      focusFieldWithError(_nameFocus);
      return;
    }
    if (_phoneError != null) {
      focusFieldWithError(_phoneFocus);
      return;
    }
    if (_emailError != null) {
      focusFieldWithError(_emailFocus);
      return;
    }

    final body = {
      'name': _name.text.trim(),
      if (!_isEdit) 'phone': _phone.text.trim(),
      'email': _email.text.trim(),
      'tags': _tags.text.trim(),
      'notes': _notes.text.trim(),
      'marketingOptIn': _marketingOptIn,
      if (_isEdit) 'idProofType': _idProofType.text.trim(),
      if (_isEdit) 'idProofNumber': _idProofNumber.text.trim(),
    };
    final ok = await ref
        .read(customersViewModelProvider.notifier)
        .saveCustomer(body, id: widget.customer?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
      return;
    }
    final message =
        ref.read(customersViewModelProvider).error ?? 'Could not save this customer.';
    setState(() => _error = message);
    focusBackendFieldError(message, [
      BackendFieldError(_phoneFocus, ['phone number']),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(customersViewModelProvider).submitting;

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit customer' : 'Add customer')),
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

                  const SectionLabel('Identity', number: 1),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _name,
                    label: 'Name',
                    required: true,
                    errorText: _nameError,
                    focusNode: _nameFocus,
                    onChanged: (_) => setState(() {}),
                    forceCapitalizeWords: true,
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _phone,
                    label: 'Phone',
                    required: true,
                    readOnly: _isEdit,
                    keyboardType: TextInputType.phone,
                    maxLength: 10,
                    errorText: _phoneError,
                    focusNode: _phoneFocus,
                    hint: '9876543210',
                    onChanged: (_) => setState(() {}),
                  ),
                  if (_isEdit) ...[
                    const SizedBox(height: AppTheme.s4),
                    const Text(
                      "Phone can't be changed here.",
                      style: TextStyle(color: AppTheme.muted, fontSize: 12),
                    ),
                  ],

                  const SectionDivider(),
                  const SectionLabel('Contact', number: 2),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _email,
                    label: 'Email (optional)',
                    keyboardType: TextInputType.emailAddress,
                    errorText: _emailError,
                    focusNode: _emailFocus,
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _tags, label: 'Tags (optional)', hint: 'e.g. VIP, Repeat guest'),

                  if (_isEdit) ...[
                    const SectionDivider(),
                    const SectionLabel('ID proof', number: 3),
                    const SizedBox(height: AppTheme.s12),
                    NeuField(controller: _idProofType, label: 'ID proof type (optional)', hint: 'e.g. Aadhaar'),
                    const SizedBox(height: AppTheme.s12),
                    NeuField(controller: _idProofNumber, label: 'ID proof number (optional)'),
                  ],

                  const SectionDivider(),
                  SectionLabel('Notes', number: _isEdit ? 4 : 3),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _notes, label: 'Notes (optional)', maxLength: 1000),
                  const SizedBox(height: AppTheme.s12),
                  Row(
                    children: [
                      Checkbox(
                        value: _marketingOptIn,
                        onChanged: (v) => setState(() => _marketingOptIn = v ?? false),
                      ),
                      const Expanded(
                        child: Text('Okay to send offers', style: TextStyle(color: AppTheme.text, fontSize: 13)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: submitting ? null : _save,
              child: submitting
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
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
      decoration: BoxDecoration(
        color: AppTheme.danger.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
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
