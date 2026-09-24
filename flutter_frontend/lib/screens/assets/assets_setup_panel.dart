import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// Assets > Setup — mirrors the Setup tab's Categories and Vendors cards in
/// AssetsPanel.jsx, following the same section-card pattern
/// events_setup_panel.dart already uses.
class AssetsSetupPanel extends ConsumerWidget {
  const AssetsSetupPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(assetsViewModelProvider);

    return RefreshIndicator(
      onRefresh: () => ref.read(assetsViewModelProvider.notifier).loadCatalogue(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, AppTheme.s24),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (state.catalogueLoading && state.categories.isEmpty && state.vendors.isEmpty)
            const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
          else ...[
            _SectionCard(
              title: 'Categories',
              hint: 'Groupings for physical property — ACs, furniture, kitchen gear.',
              addLabel: 'Add a category',
              onAdd: () => _addCategory(context, ref),
              children: [
                if (state.categories.isEmpty) const _Empty('Nothing set up yet.'),
                for (final c in state.categories) _CategoryRow(category: c),
              ],
            ),
            const SizedBox(height: AppTheme.s12),
            _SectionCard(
              title: 'Vendors',
              hint: 'Who you buy from and who services what you own.',
              addLabel: 'Add a vendor',
              onAdd: () => _editVendor(context, ref),
              children: [
                if (state.vendors.isEmpty) const _Empty('Nothing set up yet.'),
                for (final v in state.vendors) _VendorRow(vendor: v, onEdit: () => _editVendor(context, ref, vendor: v)),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _addCategory(BuildContext context, WidgetRef ref) {
    return showDialog(context: context, builder: (_) => const _CategoryDialog());
  }

  Future<void> _editVendor(BuildContext context, WidgetRef ref, {Vendor? vendor}) {
    return showDialog(context: context, builder: (_) => _VendorDialog(vendor: vendor));
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final String hint;
  final String addLabel;
  final VoidCallback onAdd;
  final List<Widget> children;

  const _SectionCard({
    required this.title,
    required this.hint,
    required this.addLabel,
    required this.onAdd,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
                    Text(hint, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.add_circle_outline_rounded, color: AppTheme.accent),
                tooltip: addLabel,
                onPressed: onAdd,
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          ...children,
        ],
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  final String message;
  const _Empty(this.message);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
    child: Text(message, style: const TextStyle(color: AppTheme.muted, fontSize: 13)),
  );
}

class _CategoryRow extends StatelessWidget {
  final AssetCategory category;
  const _CategoryRow({required this.category});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Text(
        category.name,
        style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w500, fontSize: 13.5),
      ),
    );
  }
}

class _VendorRow extends ConsumerWidget {
  final Vendor vendor;
  final VoidCallback onEdit;

  const _VendorRow({required this.vendor, required this.onEdit});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        vendor.name,
                        style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w500, fontSize: 13.5),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (!vendor.isActive) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(6)),
                        child: const Text('inactive', style: TextStyle(color: AppTheme.muted, fontSize: 10)),
                      ),
                    ],
                  ],
                ),
                if (vendor.specialty.isNotEmpty || vendor.phone.isNotEmpty)
                  Text(
                    [vendor.specialty, vendor.phone].where((s) => s.isNotEmpty).join(' · '),
                    style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                  ),
              ],
            ),
          ),
          TextButton(onPressed: onEdit, child: const Text('Edit')),
          TextButton(
            onPressed: () => ref
                .read(assetsViewModelProvider.notifier)
                .saveVendor({'isActive': !vendor.isActive}, id: vendor.id),
            child: Text(vendor.isActive ? 'Deactivate' : 'Activate'),
          ),
        ],
      ),
    );
  }
}

class _CategoryDialog extends ConsumerStatefulWidget {
  const _CategoryDialog();

  @override
  ConsumerState<_CategoryDialog> createState() => _CategoryDialogState();
}

class _CategoryDialogState extends ConsumerState<_CategoryDialog> {
  final _name = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a category name.');
      return;
    }
    final ok = await ref.read(assetsViewModelProvider.notifier).saveCategory(_name.text.trim());
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not save the category.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(assetsViewModelProvider).submitting;
    return AlertDialog(
      backgroundColor: AppTheme.bg,
      title: const Text('Add a category', style: TextStyle(color: AppTheme.heading)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              const SizedBox(height: AppTheme.s8),
            ],
            NeuField(controller: _name, label: 'Name', hint: 'Air conditioners', required: true),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: submitting ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(onPressed: submitting ? null : _save, child: Text(submitting ? 'Saving…' : 'Save')),
      ],
    );
  }
}

class _VendorDialog extends ConsumerStatefulWidget {
  final Vendor? vendor;
  const _VendorDialog({this.vendor});

  @override
  ConsumerState<_VendorDialog> createState() => _VendorDialogState();
}

class _VendorDialogState extends ConsumerState<_VendorDialog> {
  late final _name = TextEditingController(text: widget.vendor?.name ?? '');
  late final _contact = TextEditingController(text: widget.vendor?.contactPerson ?? '');
  late final _phone = TextEditingController(text: widget.vendor?.phone ?? '');
  late final _email = TextEditingController(text: widget.vendor?.email ?? '');
  late final _specialty = TextEditingController(text: widget.vendor?.specialty ?? '');
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _contact.dispose();
    _phone.dispose();
    _email.dispose();
    _specialty.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a vendor name.');
      return;
    }
    final body = {
      'name': _name.text.trim(),
      'contactPerson': _contact.text.trim(),
      'phone': _phone.text.trim(),
      'email': _email.text.trim(),
      'specialty': _specialty.text.trim(),
    };
    final ok = await ref.read(assetsViewModelProvider.notifier).saveVendor(body, id: widget.vendor?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not save the vendor.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(assetsViewModelProvider).submitting;
    return AlertDialog(
      backgroundColor: AppTheme.bg,
      title: Text(widget.vendor == null ? 'Add a vendor' : 'Edit vendor', style: const TextStyle(color: AppTheme.heading)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              const SizedBox(height: AppTheme.s8),
            ],
            NeuField(controller: _name, label: 'Name', hint: 'CoolAir Services', required: true),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _contact, label: 'Contact person', hint: 'Ramesh'),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _phone, label: 'Phone', hint: '9876543210', keyboardType: TextInputType.phone),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _email, label: 'Email', hint: 'contact@vendor.com', keyboardType: TextInputType.emailAddress),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _specialty, label: 'Specialty', hint: 'AC repair'),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: submitting ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(onPressed: submitting ? null : _save, child: Text(submitting ? 'Saving…' : 'Save')),
      ],
    );
  }
}
