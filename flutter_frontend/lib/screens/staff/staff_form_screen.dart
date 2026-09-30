import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/staff.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Add or edit a staff login — its own full page, same treatment every
/// other form in the app gets rather than a dialog. Mirrors the staff
/// create/edit modal in StaffAndRoles.jsx.
Future<void> showStaffFormScreen(BuildContext context, {StaffMember? member}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => StaffFormScreen(member: member)),
  );
}

class StaffFormScreen extends ConsumerStatefulWidget {
  final StaffMember? member;
  const StaffFormScreen({super.key, this.member});

  @override
  ConsumerState<StaffFormScreen> createState() => _StaffFormScreenState();
}

class _StaffFormScreenState extends ConsumerState<StaffFormScreen> {
  bool get _isEdit => widget.member != null;

  late final _name = TextEditingController(text: widget.member?.name ?? '');
  late final _phone = TextEditingController(text: widget.member?.phone ?? '');
  late final _email = TextEditingController(text: widget.member?.email ?? '');
  late final _tempPassword = TextEditingController();
  late String? _roleKey = widget.member?.roleKey;
  String? _error;
  bool _submitAttempted = false;

  final _nameFocus = FocusNode();

  static final _phoneTen = RegExp(r'^[6-9]\d{9}$');

  String? get _nameError =>
      (_submitAttempted && _name.text.trim().isEmpty) ? 'Enter a name.' : null;

  String? get _phoneError {
    if (!_submitAttempted) return null;
    if (_phone.text.trim().isEmpty) return 'Enter a phone number.';
    if (!_phoneTen.hasMatch(_phone.text.trim())) {
      return 'Enter a valid 10-digit mobile number (starting 6-9).';
    }
    return null;
  }

  String? get _roleError =>
      (_submitAttempted && (_roleKey == null || _roleKey!.isEmpty)) ? 'Choose a role.' : null;

  String? get _passwordError {
    if (_isEdit || !_submitAttempted) return null;
    if (_tempPassword.text.length < 8) {
      return 'Temporary password must be at least 8 characters.';
    }
    return null;
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _email.dispose();
    _tempPassword.dispose();
    _nameFocus.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _submitAttempted = true);
    if (_nameError != null) {
      _nameFocus.requestFocus();
      return;
    }
    if (_phoneError != null || _roleError != null || _passwordError != null) {
      setState(() {});
      return;
    }

    final body = {
      'name': _name.text.trim(),
      'phone': _phone.text.trim(),
      'email': _email.text.trim(),
      'roleKey': _roleKey,
      if (!_isEdit) 'tempPassword': _tempPassword.text,
    };
    final ok = await ref
        .read(staffViewModelProvider.notifier)
        .saveStaff(body, id: widget.member?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() {
        _error = ref.read(staffViewModelProvider).error ?? 'Could not save this staff member.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final roles = ref.watch(staffViewModelProvider).roles;
    final submitting = ref.watch(staffViewModelProvider).submitting;

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit staff' : 'Add staff')),
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
                  Text(
                    _isEdit
                        ? "Their details and what they can reach. Changing the role changes it immediately."
                        : 'They sign in with their phone number and the temporary password you set here.',
                    style: const TextStyle(color: AppTheme.muted, fontSize: 13),
                  ),
                  const SizedBox(height: AppTheme.s16),

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
                    keyboardType: TextInputType.phone,
                    maxLength: 10,
                    errorText: _phoneError,
                    hint: '9876543210',
                    onChanged: (_) => setState(() {}),
                  ),

                  const SectionDivider(),
                  const SectionLabel('Access', number: 2),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _email,
                    label: 'Email (optional)',
                    keyboardType: TextInputType.emailAddress,
                  ),
                  const SizedBox(height: AppTheme.s12),
                  RequiredLabel('Role'),
                  const SizedBox(height: AppTheme.s4),
                  OptionDropdown(
                    values: [for (final r in roles) r.roleKey],
                    labels: {for (final r in roles) r.roleKey: r.name},
                    selected: _roleKey,
                    hint: 'Choose a role',
                    hasError: _roleError != null,
                    onSelect: (v) => setState(() => _roleKey = v),
                  ),
                  if (_roleError != null) ...[
                    const SizedBox(height: AppTheme.s4),
                    Text(_roleError!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                  ],

                  if (!_isEdit) ...[
                    const SectionDivider(),
                    const SectionLabel('Temporary password', number: 3),
                    const SizedBox(height: AppTheme.s12),
                    NeuField(
                      controller: _tempPassword,
                      label: 'Temporary password',
                      required: true,
                      hint: 'At least 8 characters',
                      errorText: _passwordError,
                      onChanged: (_) => setState(() {}),
                    ),
                    const SizedBox(height: AppTheme.s8),
                    const Text(
                      "Share this with them — they'll be asked to set their own after signing in.",
                      style: TextStyle(color: AppTheme.muted, fontSize: 12),
                    ),
                  ],
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
