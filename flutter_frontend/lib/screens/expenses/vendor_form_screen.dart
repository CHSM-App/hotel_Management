import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart' show Vendor;
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Add or edit a vendor — its own full page rather than a dialog, the same
/// treatment every other form in the app gets. Writes to the shared
/// dbo.vendors directory Asset inventory's own Setup tab also edits — a
/// vendor added here shows up there too.
Future<void> showVendorFormScreen(BuildContext context, {Vendor? vendor}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => VendorFormScreen(vendor: vendor)),
  );
}

class VendorFormScreen extends ConsumerStatefulWidget {
  final Vendor? vendor;
  const VendorFormScreen({super.key, this.vendor});

  @override
  ConsumerState<VendorFormScreen> createState() => _VendorFormScreenState();
}

class _VendorFormScreenState extends ConsumerState<VendorFormScreen> {
  bool get _isEdit => widget.vendor != null;

  late final _name = TextEditingController(text: widget.vendor?.name ?? '');
  late final _contact = TextEditingController(text: widget.vendor?.contactPerson ?? '');
  late final _phone = TextEditingController(text: widget.vendor?.phone ?? '');
  late final _email = TextEditingController(text: widget.vendor?.email ?? '');
  late final _specialty = TextEditingController(text: widget.vendor?.specialty ?? '');
  late final _notes = TextEditingController(text: widget.vendor?.notes ?? '');
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _contact.dispose();
    _phone.dispose();
    _email.dispose();
    _specialty.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _error = null);
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Vendor name is required.');
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
    final ok = await ref.read(expensesViewModelProvider.notifier).saveVendor(body, id: widget.vendor?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(expensesViewModelProvider).error ?? 'Could not save this vendor.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(expensesViewModelProvider).submitting;
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit vendor' : 'Add vendor')),
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
                  NeuField(controller: _name, label: 'Name', required: true),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _contact, label: 'Contact person'),

                  const SectionDivider(),
                  const SectionLabel('Contact details', number: 2),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _phone, label: 'Phone', keyboardType: TextInputType.phone),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _email, label: 'Email', keyboardType: TextInputType.emailAddress),

                  const SectionDivider(),
                  const SectionLabel('Notes', number: 3),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _specialty, label: 'Specialty', hint: 'AC repair, catering, linen…'),
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
