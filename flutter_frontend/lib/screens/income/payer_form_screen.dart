import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/form_feedback.dart';
import '../../domain/models/asset.dart' show Vendor;
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Add or edit a payer — its own full page rather than a dialog, the same
/// treatment every other form in the app gets. Writes to the shared
/// dbo.vendors directory through the Income module's own /income/payers
/// route (type 'income') — mirrors vendor_form_screen.dart.
Future<void> showPayerFormScreen(BuildContext context, {Vendor? payer}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => PayerFormScreen(payer: payer)),
  );
}

class PayerFormScreen extends ConsumerStatefulWidget {
  final Vendor? payer;
  const PayerFormScreen({super.key, this.payer});

  @override
  ConsumerState<PayerFormScreen> createState() => _PayerFormScreenState();
}

class _PayerFormScreenState extends ConsumerState<PayerFormScreen> {
  bool get _isEdit => widget.payer != null;

  late final _name = TextEditingController(text: widget.payer?.name ?? '');
  late final _contact = TextEditingController(text: widget.payer?.contactPerson ?? '');
  late final _phone = TextEditingController(text: widget.payer?.phone ?? '');
  late final _email = TextEditingController(text: widget.payer?.email ?? '');
  late final _specialty = TextEditingController(text: widget.payer?.specialty ?? '');
  late final _notes = TextEditingController(text: widget.payer?.notes ?? '');
  String? _error;
  String? _backendErrorField;
  bool _submitAttempted = false;

  String? get _nameError {
    if (_submitAttempted && _name.text.trim().isEmpty) return 'Payer name is required.';
    if (_backendErrorField == 'name') return _error;
    return null;
  }

  String? get _phoneError => _backendErrorField == 'phone' ? _error : null;

  final _nameFocus = FocusNode();
  final _phoneFocus = FocusNode();

  @override
  void dispose() {
    _name.dispose();
    _contact.dispose();
    _phone.dispose();
    _email.dispose();
    _specialty.dispose();
    _notes.dispose();
    _nameFocus.dispose();
    _phoneFocus.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _error = null;
      _backendErrorField = null;
      _submitAttempted = true;
    });
    if (_nameError != null) {
      focusFieldWithError(_nameFocus);
      return;
    }
    final body = {
      'name': _name.text.trim(),
      'contactPerson': _contact.text.trim(),
      'phone': _phone.text.trim(),
      'email': _email.text.trim(),
      'specialty': _specialty.text.trim(),
      'notes': _notes.text.trim(),
    };
    final ok = await ref.read(incomeViewModelProvider.notifier).savePayer(body, id: widget.payer?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
      return;
    }
    final state = ref.read(incomeViewModelProvider);
    final message = state.error ?? 'Could not save this payer.';
    setState(() {
      _error = message;
      _backendErrorField = state.errorField;
    });
    switch (state.errorField) {
      case 'name':
        focusFieldWithError(_nameFocus);
        break;
      case 'phone':
        focusFieldWithError(_phoneFocus);
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(incomeViewModelProvider).submitting;
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit payer' : 'Add payer')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_error != null && _backendErrorField != 'name' && _backendErrorField != 'phone') ...[
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
                  NeuField(controller: _contact, label: 'Contact person', forceCapitalizeWords: true),

                  const SectionDivider(),
                  const SectionLabel('Contact details', number: 2),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _phone,
                    label: 'Phone',
                    keyboardType: TextInputType.phone,
                    errorText: _phoneError,
                    focusNode: _phoneFocus,
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _email, label: 'Email', keyboardType: TextInputType.emailAddress),

                  const SectionDivider(),
                  const SectionLabel('Notes', number: 3),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _specialty, label: 'Specialty', hint: 'Shop tenant, event partner…'),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _notes, label: 'Notes'),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: submitting ? null : _save,
              child: submitting
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
