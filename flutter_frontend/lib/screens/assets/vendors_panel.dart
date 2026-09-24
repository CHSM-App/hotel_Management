import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'asset_icons.dart';

/// Assets > Vendors — mirrors the Vendors tab in AssetsPanel.jsx: a plain
/// list (name, specialty · phone), tap to edit, "Add vendor" to file a new
/// one. Categories have no equivalent tab on the web app either — they are
/// only ever named inline, from the register form's own Category field (see
/// _CategoryField in asset_form_sheet.dart), so there is nothing to manage
/// here beyond vendors.
class VendorsPanel extends ConsumerWidget {
  const VendorsPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(assetsViewModelProvider);

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(assetsViewModelProvider.notifier).loadCatalogue(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              if (state.catalogueLoading && state.vendors.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (state.vendors.isEmpty)
                const NeuNotice(
                  icon: Icons.storefront_outlined,
                  message: 'No vendors yet. Add the AC contractor, lift AMC firm, or electrician you call for repairs.',
                )
              else
                for (final v in state.vendors)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _VendorCard(vendor: v, onTap: () => _editVendor(context, vendor: v)),
                  ),
            ],
          ),
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            onPressed: () => _editVendor(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }

  Future<void> _editVendor(BuildContext context, {Vendor? vendor}) {
    return Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => VendorFormScreen(vendor: vendor)),
    );
  }
}

class _VendorCard extends ConsumerWidget {
  final Vendor vendor;
  final VoidCallback onTap;

  const _VendorCard({required this.vendor, required this.onTap});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          VendorInitialBadge(name: vendor.name, active: vendor.isActive),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        vendor.name,
                        style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 14.5),
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
                const SizedBox(height: 2),
                Text(
                  [vendor.specialty.isEmpty ? 'No specialty set' : vendor.specialty, vendor.phone].where((s) => s.isNotEmpty).join(' · '),
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () => ref.read(assetsViewModelProvider.notifier).saveVendor({'isActive': !vendor.isActive}, id: vendor.id),
            child: Text(vendor.isActive ? 'Deactivate' : 'Activate'),
          ),
        ],
      ),
    );
  }
}

/// Add/edit a vendor — mirrors the vendor form in AssetsPanel.jsx field for
/// field: Name, Contact person, Phone, Email, Specialty, Notes.
class VendorFormScreen extends ConsumerStatefulWidget {
  final Vendor? vendor;
  const VendorFormScreen({super.key, this.vendor});

  @override
  ConsumerState<VendorFormScreen> createState() => _VendorFormScreenState();
}

class _VendorFormScreenState extends ConsumerState<VendorFormScreen> {
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
      'notes': _notes.text.trim(),
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
    return Scaffold(
      appBar: AppBar(title: Text(widget.vendor == null ? 'Add vendor' : 'Edit vendor')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              const SizedBox(height: AppTheme.s12),
            ],
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Contact details', number: 1),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _name, label: 'Name', required: true),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _contact, label: 'Contact person'),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _phone, label: 'Phone', keyboardType: TextInputType.phone),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _email, label: 'Email', keyboardType: TextInputType.emailAddress),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s16),
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Notes', number: 2),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _specialty, label: 'Specialty', hint: 'AC service, Electrical, Lift AMC…'),
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
