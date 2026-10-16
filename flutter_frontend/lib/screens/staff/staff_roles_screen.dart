import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/staff.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/staff_viewmodel.dart';
import '../../widgets/neu.dart';
import '../../widgets/pill_tabs.dart';
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

class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return PillTabs(
      selected: selected,
      onSelect: onSelect,
      tabs: const [
        PillTab('staff', 'Staff', Icons.badge_rounded),
        PillTab('roles', 'Roles & access', Icons.admin_panel_settings_rounded),
      ],
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
    final contact = [
      if (member.email != null && member.email!.isNotEmpty) member.email!,
      member.phone,
    ].join(' · ');

    final statusColor = member.isActive ? AppTheme.vacant : AppTheme.muted;

    return NeuCard(
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8 + 2),
      onTap: () => showStaffFormScreen(context, member: member),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: AppTheme.sidebarBrandWash, shape: BoxShape.circle),
                child: Text(
                  member.name.isNotEmpty ? member.name[0].toUpperCase() : '?',
                  style: const TextStyle(color: AppTheme.sidebarBrandInk, fontWeight: FontWeight.w700, fontSize: 14),
                ),
              ),
              Positioned(
                right: -1,
                bottom: -1,
                child: Container(
                  width: 11,
                  height: 11,
                  decoration: BoxDecoration(
                    color: statusColor,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppTheme.card, width: 2),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        member.name,
                        style: Theme.of(context)
                            .textTheme
                            .titleSmall
                            ?.copyWith(fontSize: 14.5, fontWeight: FontWeight.w700),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 6),
                    _RolePill(text: member.roleName),
                  ],
                ),
                if (contact.isNotEmpty) ...[
                  const SizedBox(height: 1),
                  Text(
                    contact,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s4),
          _StaffRowMenu(
            showEnable: member.roleKey != 'OWNER',
            isActive: member.isActive,
            onResetPassword: () => _resetPassword(context, ref),
            onToggleActive: () => _toggleActive(context, ref),
          ),
        ],
      ),
    );
  }
}

/// The staff row's own overflow menu — icon-chip items on a raised
/// rounded surface, same language as [NeuRowMenu], sized for the two
/// actions a staff row needs instead of the fixed edit/delete pair.
class _StaffRowMenu extends StatelessWidget {
  final bool showEnable;
  final bool isActive;
  final VoidCallback onResetPassword;
  final VoidCallback onToggleActive;

  const _StaffRowMenu({
    required this.showEnable,
    required this.isActive,
    required this.onResetPassword,
    required this.onToggleActive,
  });

  Widget _item(IconData icon, String label, Color color) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 28,
          height: 28,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: color.withValues(alpha: 0.10), shape: BoxShape.circle),
          child: Icon(icon, size: 15, color: color),
        ),
        const SizedBox(width: 10),
        Text(label, style: TextStyle(color: color, fontSize: 13.5, fontWeight: FontWeight.w600)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      padding: EdgeInsets.zero,
      splashRadius: 18,
      icon: const Icon(Icons.more_vert_rounded, size: 19, color: AppTheme.muted),
      elevation: 6,
      color: AppTheme.card,
      surfaceTintColor: Colors.transparent,
      shadowColor: const Color(0x33101828),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        side: const BorderSide(color: AppTheme.border),
      ),
      constraints: const BoxConstraints(minWidth: 180),
      onSelected: (v) => v == 'reset' ? onResetPassword() : onToggleActive(),
      itemBuilder: (context) => [
        PopupMenuItem(
          value: 'reset',
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
          child: _item(Icons.lock_reset_rounded, 'Reset password', AppTheme.heading),
        ),
        // The backend refuses the last active owner anyway; hiding the
        // control here means the only owner never sees a button that can
        // only ever answer with an error.
        if (showEnable) ...[
          const PopupMenuDivider(height: 1),
          PopupMenuItem(
            value: 'toggle',
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
            child: _item(
              isActive ? Icons.block_rounded : Icons.check_circle_outline_rounded,
              isActive ? 'Disable' : 'Enable',
              isActive ? AppTheme.danger : AppTheme.vacant,
            ),
          ),
        ],
      ],
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

  Widget _iconAction({
    required String tooltip,
    required IconData icon,
    required Color color,
    required VoidCallback onPressed,
  }) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          width: 30,
          height: 30,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: color.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(8)),
          child: Icon(icon, size: 16, color: color),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: AppTheme.s8,
                  runSpacing: AppTheme.s4,
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
              const SizedBox(width: AppTheme.s8),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _iconAction(
                    tooltip: 'Edit access for ${role.name}',
                    icon: Icons.edit_outlined,
                    color: AppTheme.heading,
                    onPressed: () => showRoleFormScreen(context, role: role),
                  ),
                  if (role.isOverridden) ...[
                    const SizedBox(width: 6),
                    _iconAction(
                      tooltip: 'Reset to default',
                      icon: Icons.restore_rounded,
                      color: AppTheme.accent,
                      onPressed: () => _resetToDefault(context, ref),
                    ),
                  ],
                  if (role.isCustom) ...[
                    const SizedBox(width: 6),
                    _iconAction(
                      tooltip: 'Delete ${role.name}',
                      icon: Icons.delete_outline_rounded,
                      color: AppTheme.danger,
                      onPressed: () => _delete(context, ref),
                    ),
                  ],
                ],
              ),
            ],
          ),
          if (role.description != null && role.description!.isNotEmpty) ...[
            const SizedBox(height: AppTheme.s4),
            Text(
              role.description!,
              style: const TextStyle(color: AppTheme.muted, fontSize: 13),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
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

/// A compact role tag that sits inline next to the staff member's name —
/// replaces the old full-width "Active" badge row with a single glance.
class _RolePill extends StatelessWidget {
  final String text;

  const _RolePill({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: AppTheme.accent.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: const TextStyle(color: AppTheme.accent, fontSize: 10.5, fontWeight: FontWeight.w700),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
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
      padding: const EdgeInsets.fromLTRB(8, 5, 10, 5),
      decoration: BoxDecoration(
        color: AppTheme.vacant.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 14,
            height: 14,
            alignment: Alignment.center,
            decoration: const BoxDecoration(color: AppTheme.vacant, shape: BoxShape.circle),
            child: const Icon(Icons.check_rounded, size: 10, color: Colors.white),
          ),
          const SizedBox(width: 6),
          Text(
            text,
            style: const TextStyle(color: AppTheme.heading, fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
