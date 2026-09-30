import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/staff.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/staff_viewmodel.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'role_form_screen.dart';
import 'staff_form_screen.dart';

/// Staff logins and the roles that gate them — mirrors StaffAndRoles.jsx's
/// shell exactly: two tabs, one load, over the same /staff and /roles
/// endpoints.
class StaffRolesScreen extends ConsumerStatefulWidget {
  const StaffRolesScreen({super.key});

  @override
  ConsumerState<StaffRolesScreen> createState() => _StaffRolesScreenState();
}

class _StaffRolesScreenState extends ConsumerState<StaffRolesScreen> {
  String _tab = 'staff';

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(staffViewModelProvider.notifier).loadAll());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(staffViewModelProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s16,
            AppTheme.s8,
            AppTheme.s16,
            AppTheme.s8,
          ),
          child: _SubTabs(selected: _tab, onSelect: (t) => setState(() => _tab = t)),
        ),
        Expanded(
          child: _Body(state: state, tab: _tab),
        ),
      ],
    );
  }
}

class _Body extends ConsumerWidget {
  final StaffState state;
  final String tab;

  const _Body({required this.state, required this.tab});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (state.error != null) {
      return NeuNotice(
        message: state.error!,
        icon: Icons.cloud_off_rounded,
        action: NeuButton(
          onPressed: () => ref.read(staffViewModelProvider.notifier).loadAll(),
          child: const Text('Try again'),
        ),
      );
    }
    if (state.isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    return tab == 'roles' ? const _RolesTab() : const _StaffTab();
  }
}

/// Same sliding-pill segmented control Expenses/Assets/Billing/Rooms &
/// Rates each carry their own copy of.
class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const _tabs = {'staff': 'Staff', 'roles': 'Roles & access'};

  static const double _height = 44;

  @override
  Widget build(BuildContext context) {
    final keys = _tabs.keys.toList();
    final selectedIndex = keys.indexOf(selected).clamp(0, keys.length - 1);

    Widget segment(String key, String label) {
      final isSelected = key == selected;
      return Expanded(
        child: GestureDetector(
          onTap: () => onSelect(key),
          behavior: HitTestBehavior.opaque,
          child: SizedBox(
            height: _height,
            child: Center(
              child: AnimatedDefaultTextStyle(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeOut,
                style: TextStyle(
                  color: isSelected ? Colors.white : AppTheme.text,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                  fontSize: 13,
                ),
                child: Text(label, overflow: TextOverflow.ellipsis),
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      height: _height,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Stack(
        children: [
          AnimatedAlign(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            alignment: Alignment(-1 + (2 / (keys.length - 1)) * selectedIndex, 0),
            child: FractionallySizedBox(
              widthFactor: 1 / keys.length,
              child: Container(
                height: _height - 8,
                decoration: BoxDecoration(
                  color: AppTheme.accent,
                  borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
                ),
              ),
            ),
          ),
          Row(children: [for (final e in _tabs.entries) segment(e.key, e.value)]),
        ],
      ),
    );
  }
}

// ── Staff tab ────────────────────────────────────────────────────────────

class _StaffTab extends ConsumerWidget {
  const _StaffTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final staff = ref.watch(staffViewModelProvider).staff;

    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, 0, AppTheme.s16, AppTheme.s32 + 56),
          children: [
            Text(
              '${staff.length} staff member${staff.length == 1 ? '' : 's'}',
              style: const TextStyle(color: AppTheme.muted, fontSize: 13),
            ),
            const SizedBox(height: AppTheme.s12),
            if (staff.isEmpty)
              const NeuNotice(message: 'No staff logins yet.', icon: Icons.people_outline_rounded)
            else
              for (final member in staff) ...[
                _StaffRow(member: member),
                const SizedBox(height: AppTheme.s8),
              ],
          ],
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            tooltip: 'Add staff',
            onPressed: () => showStaffFormScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _StaffRow extends ConsumerWidget {
  final StaffMember member;

  const _StaffRow({required this.member});

  Future<void> _resetPassword(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController();
    final tempPassword = await showDialog<String>(
      context: context,
      builder: (dialogContext) => _ResetPasswordDialog(name: member.name, controller: controller),
    );
    if (tempPassword == null || !context.mounted) return;
    final ok = await ref.read(staffViewModelProvider.notifier).resetPassword(member.id, tempPassword);
    if (!context.mounted) return;
    final message = ok
        ? '${member.name} can sign in with this password and will be asked to change it.'
        : ref.read(staffViewModelProvider).error ?? 'Could not reset the password.';
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _toggleActive(BuildContext context, WidgetRef ref) async {
    final ok = await ref.read(staffViewModelProvider.notifier).toggleStaffActive(member);
    if (!ok && context.mounted) {
      final message = ref.read(staffViewModelProvider).error ?? 'Could not update this staff member.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: const BoxDecoration(color: AppTheme.sidebarBrandWash, shape: BoxShape.circle),
            child: Text(
              member.name.isNotEmpty ? member.name[0].toUpperCase() : '?',
              style: const TextStyle(color: AppTheme.sidebarBrandInk, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(member.name, style: Theme.of(context).textTheme.titleSmall),
                if (member.email != null && member.email!.isNotEmpty)
                  Text(member.email!, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
                Text(member.phone, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
                const SizedBox(height: AppTheme.s8),
                Wrap(
                  spacing: AppTheme.s8,
                  runSpacing: AppTheme.s4,
                  children: [
                    _Badge(text: member.roleName, color: AppTheme.accent),
                    _Badge(
                      text: member.isActive ? 'Active' : 'Disabled',
                      color: member.isActive ? AppTheme.vacant : AppTheme.muted,
                    ),
                    if (member.mustResetPassword)
                      const _Badge(text: 'Temporary password', color: AppTheme.draft),
                  ],
                ),
              ],
            ),
          ),
          PopupMenuButton<String>(
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.more_vert_rounded, size: 20, color: AppTheme.muted),
            color: AppTheme.card,
            surfaceTintColor: Colors.transparent,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppTheme.rMedium),
              side: const BorderSide(color: AppTheme.border),
            ),
            onSelected: (v) {
              switch (v) {
                case 'edit':
                  showStaffFormScreen(context, member: member);
                case 'reset':
                  _resetPassword(context, ref);
                case 'toggle':
                  _toggleActive(context, ref);
              }
            },
            itemBuilder: (context) => [
              const PopupMenuItem(value: 'edit', child: Text('Edit')),
              const PopupMenuItem(value: 'reset', child: Text('Reset password')),
              // The backend refuses the last active owner anyway; hiding the
              // control here means the only owner never sees a button that
              // can only ever answer with an error.
              if (member.roleKey != 'OWNER')
                PopupMenuItem(
                  value: 'toggle',
                  child: Text(member.isActive ? 'Disable' : 'Enable'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ResetPasswordDialog extends StatefulWidget {
  final String name;
  final TextEditingController controller;

  const _ResetPasswordDialog({required this.name, required this.controller});

  @override
  State<_ResetPasswordDialog> createState() => _ResetPasswordDialogState();
}

class _ResetPasswordDialogState extends State<_ResetPasswordDialog> {
  String? _error;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Reset password for ${widget.name}'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Sets a password to sign in with once. They are asked to choose their own right after.',
            style: TextStyle(color: AppTheme.muted, fontSize: 13),
          ),
          const SizedBox(height: AppTheme.s16),
          NeuField(
            controller: widget.controller,
            label: 'Temporary password',
            required: true,
            hint: 'At least 8 characters',
            errorText: _error,
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(
          onPressed: () {
            if (widget.controller.text.length < 8) {
              setState(() => _error = 'Must be at least 8 characters.');
              return;
            }
            Navigator.pop(context, widget.controller.text);
          },
          child: const Text('Reset password'),
        ),
      ],
    );
  }
}

// ── Roles tab ────────────────────────────────────────────────────────────

class _RolesTab extends ConsumerWidget {
  const _RolesTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(staffViewModelProvider);

    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, 0, AppTheme.s16, AppTheme.s32 + 56),
          children: [
            const Text(
              'Built-in roles come preset. Tick extra access to override one, or add your own.',
              style: TextStyle(color: AppTheme.muted, fontSize: 13),
            ),
            const SizedBox(height: AppTheme.s12),
            for (final role in state.roles) ...[
              _RoleCard(role: role, labelFor: state.labelFor),
              const SizedBox(height: AppTheme.s8),
            ],
          ],
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            tooltip: 'Add role',
            onPressed: () => showRoleFormScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _RoleCard extends ConsumerWidget {
  final LodgeRole role;
  final String Function(String) labelFor;

  const _RoleCard({required this.role, required this.labelFor});

  Future<void> _resetToDefault(BuildContext context, WidgetRef ref) async {
    final ok = await ref.read(staffViewModelProvider.notifier).resetRole(role.roleKey);
    if (!ok && context.mounted) {
      final message = ref.read(staffViewModelProvider).error ?? 'Could not reset this role.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Delete ${role.name}'),
        content: const Text("This can't be undone.", style: TextStyle(color: AppTheme.muted)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Delete role', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final ok = await ref.read(staffViewModelProvider.notifier).deleteRole(role.roleKey);
    if (!ok && context.mounted) {
      final message = ref.read(staffViewModelProvider).error ?? 'Could not delete this role.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: AppTheme.s8,
                  children: [
                    Text(role.name, style: Theme.of(context).textTheme.titleSmall),
                    _Badge(
                      text: role.isSystem ? 'Built-in' : 'Custom',
                      color: role.isSystem ? AppTheme.muted : AppTheme.accent,
                    ),
                    if (role.isOverridden) const _Badge(text: 'Customised', color: AppTheme.draft),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Edit access for ${role.name}',
                icon: const Icon(Icons.edit_outlined, size: 18),
                onPressed: () => showRoleFormScreen(context, role: role),
              ),
              if (role.isOverridden)
                IconButton(
                  tooltip: 'Reset to default',
                  icon: const Icon(Icons.restore_rounded, size: 18),
                  onPressed: () => _resetToDefault(context, ref),
                ),
              if (role.isCustom)
                IconButton(
                  tooltip: 'Delete ${role.name}',
                  icon: const Icon(Icons.delete_outline_rounded, size: 18, color: AppTheme.danger),
                  onPressed: () => _delete(context, ref),
                ),
            ],
          ),
          if (role.description != null && role.description!.isNotEmpty) ...[
            const SizedBox(height: AppTheme.s4),
            Text(role.description!, style: const TextStyle(color: AppTheme.muted, fontSize: 13)),
          ],
          const SizedBox(height: AppTheme.s12),
          if (role.permissions.isEmpty)
            const Text('No access granted yet.', style: TextStyle(color: AppTheme.muted, fontSize: 12))
          else
            Wrap(
              spacing: AppTheme.s8,
              runSpacing: AppTheme.s8,
              children: [
                for (final key in role.permissions) _Chip(text: labelFor(key)),
              ],
            ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String text;
  final Color color;

  const _Badge({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
      child: Text(
        text,
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String text;

  const _Chip({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s4),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.border),
      ),
      child: Text(text, style: const TextStyle(color: AppTheme.text, fontSize: 12)),
    );
  }
}
