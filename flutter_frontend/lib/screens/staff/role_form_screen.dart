import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/form_feedback.dart';
import '../../domain/models/staff.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Add or edit a role's access — its own full page, mirrors the role
/// create/edit modal in StaffAndRoles.jsx. A built-in role's name and
/// description are locked (the web disables those inputs too); only its
/// permission list can be changed, which writes a lodge-scoped override
/// rather than touching the shared default row.
Future<void> showRoleFormScreen(BuildContext context, {LodgeRole? role}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => RoleFormScreen(role: role)),
  );
}

class RoleFormScreen extends ConsumerStatefulWidget {
  final LodgeRole? role;
  const RoleFormScreen({super.key, this.role});

  @override
  ConsumerState<RoleFormScreen> createState() => _RoleFormScreenState();
}

class _RoleFormScreenState extends ConsumerState<RoleFormScreen> {
  bool get _isEdit => widget.role != null;
  bool get _locked => widget.role?.isSystem ?? false;

  late final _name = TextEditingController(text: widget.role?.name ?? '');
  late final _description = TextEditingController(text: widget.role?.description ?? '');
  late final Set<String> _permissions = {...?widget.role?.permissions};

  String? _error;
  String? _backendErrorField;
  bool _nameInvalid = false;
  bool _permissionsInvalid = false;

  String? get _nameError {
    if (_nameInvalid) return 'Enter a role name.';
    if (_backendErrorField == 'roleName') return _error;
    return null;
  }

  final _nameFocus = FocusNode();

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _nameFocus.dispose();
    super.dispose();
  }

  void _toggle(String key) {
    setState(() {
      if (_permissionsInvalid) _permissionsInvalid = false;
      if (_permissions.contains(key)) {
        _permissions.remove(key);
      } else {
        _permissions.add(key);
      }
    });
  }

  Future<void> _save() async {
    setState(() {
      _error = null;
      _backendErrorField = null;
      _nameInvalid = false;
      _permissionsInvalid = false;
    });
    if (_name.text.trim().isEmpty) {
      setState(() {
        _error = 'Enter a role name.';
        _nameInvalid = true;
      });
      focusFieldWithError(_nameFocus);
      return;
    }
    // A role with nothing ticked grants nothing — anyone assigned to it
    // signs in to an empty app.
    if (_permissions.isEmpty) {
      setState(() {
        _error = 'Select at least one access for this role.';
        _permissionsInvalid = true;
      });
      return;
    }

    final body = {
      'name': _name.text.trim(),
      'description': _description.text.trim(),
      'permissions': _permissions.toList(),
    };
    final ok = await ref
        .read(staffViewModelProvider.notifier)
        .saveRole(body, roleKey: widget.role?.roleKey);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
      return;
    }
    final state = ref.read(staffViewModelProvider);
    setState(() {
      _error = state.error ?? 'Could not save this role.';
      _backendErrorField = state.errorField;
    });
    if (state.errorField == 'roleName') {
      focusFieldWithError(_nameFocus);
    }
  }

  @override
  Widget build(BuildContext context) {
    final catalog = ref.watch(staffViewModelProvider).permissions;
    final submitting = ref.watch(staffViewModelProvider).submitting;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          _isEdit ? 'Edit ${widget.role!.name}' : 'Add role',
          overflow: TextOverflow.ellipsis,
          maxLines: 1,
        ),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s16),
              children: [
                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.elevated,
                  padding: const EdgeInsets.all(AppTheme.s12 + 2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_error != null && _backendErrorField != 'roleName') ...[
                        _ErrorBanner(_error!),
                        const SizedBox(height: AppTheme.s12),
                      ],
                      const Text(
                        'A job title and what it can reach. Staff are given a role rather than '
                        'individual permissions, so changing it here changes it for everyone who '
                        'holds it.',
                        style: TextStyle(color: AppTheme.muted, fontSize: 13),
                      ),
                      if (_locked) ...[
                        const SizedBox(height: AppTheme.s8),
                        Container(
                          padding: const EdgeInsets.all(AppTheme.s12),
                          decoration: BoxDecoration(
                            color: AppTheme.accent.withValues(alpha: 0.06),
                            borderRadius: BorderRadius.circular(AppTheme.rSmall),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(Icons.info_outline_rounded, size: 15, color: AppTheme.accent),
                              const SizedBox(width: AppTheme.s8),
                              Expanded(
                                child: Text(
                                  'This is a built-in role. Saving keeps your changes for this lodge only — '
                                  'you can reset it to the default at any time.',
                                  style: TextStyle(color: AppTheme.text, fontSize: 12.5),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                      const SizedBox(height: AppTheme.s12),

                      const SectionLabel('Details', number: 1, icon: Icons.badge_rounded),
                      const SizedBox(height: AppTheme.s8),
                      NeuField(
                        dense: true,
                        controller: _name,
                        label: 'Role name',
                        required: true,
                        readOnly: _locked,
                        errorText: _nameError,
                        focusNode: _nameFocus,
                        hint: 'Night Manager',
                        forceCapitalizeWords: true,
                      ),
                      const SizedBox(height: AppTheme.s8),
                      NeuField(
                        dense: true,
                        controller: _description,
                        label: 'Description (optional)',
                        readOnly: _locked,
                      ),

                      const SectionDivider(),
                      SectionLabel(
                        'Access',
                        number: 2,
                        icon: Icons.vpn_key_rounded,
                        trailing: '${_permissions.length} of ${catalog.length} selected',
                      ),
                      const SizedBox(height: 6),
                      RequiredLabel('What this role can reach'),
                      const SizedBox(height: AppTheme.s8),
                      Container(
                        clipBehavior: Clip.antiAlias,
                        decoration: BoxDecoration(
                          color: AppTheme.bg,
                          borderRadius: BorderRadius.circular(AppTheme.rMedium),
                          border: Border.all(
                            color: _permissionsInvalid ? AppTheme.danger : AppTheme.border,
                            width: _permissionsInvalid ? 1.6 : 1,
                          ),
                        ),
                        child: Column(
                          children: [
                            for (int i = 0; i < catalog.length; i++)
                              _PermissionRow(
                                permission: catalog[i],
                                checked: _permissions.contains(catalog[i].key),
                                onTap: () => _toggle(catalog[i].key),
                                showDivider: i != catalog.length - 1,
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s12),
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
                      : const Text('Save access'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PermissionRow extends StatelessWidget {
  final PermissionInfo permission;
  final bool checked;
  final VoidCallback onTap;
  final bool showDivider;

  const _PermissionRow({
    required this.permission,
    required this.checked,
    required this.onTap,
    required this.showDivider,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        InkWell(
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
            color: checked ? AppTheme.accent.withValues(alpha: 0.06) : AppTheme.card,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 120),
                  width: 20,
                  height: 20,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: checked ? AppTheme.accent : Colors.transparent,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: checked ? AppTheme.accent : AppTheme.border, width: 1.4),
                  ),
                  child: checked
                      ? const Icon(Icons.check_rounded, size: 14, color: Colors.white)
                      : null,
                ),
                const SizedBox(width: AppTheme.s12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        permission.label,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: checked ? AppTheme.heading : AppTheme.text,
                          fontWeight: checked ? FontWeight.w700 : FontWeight.w600,
                        ),
                      ),
                      if (permission.description.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          permission.description,
                          style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        if (showDivider) const Divider(height: 1, color: AppTheme.border),
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
