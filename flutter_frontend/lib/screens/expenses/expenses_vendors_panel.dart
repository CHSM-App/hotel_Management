import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart' show Vendor;
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'vendor_form_screen.dart';

/// Expenses > Vendors — mirrors the Vendors tab in ExpensesPanel.jsx: a
/// plain list, tap to edit. Same shared dbo.vendors directory Asset
/// inventory's own Setup tab edits — a vendor added here shows up there too.
class ExpensesVendorsPanel extends ConsumerWidget {
  const ExpensesVendorsPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(expensesViewModelProvider);
    final vendors = state.vendors;

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(expensesViewModelProvider.notifier).loadCatalogue(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              if (state.catalogueLoading && vendors.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (vendors.isEmpty)
                const NeuNotice(icon: Icons.storefront_outlined, message: 'No vendors yet. Add anyone you regularly pay for supplies or services.')
              else
                for (final v in vendors)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _VendorCard(vendor: v, onTap: () => showVendorFormScreen(context, vendor: v)),
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
            onPressed: () => showVendorFormScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _VendorCard extends StatelessWidget {
  final Vendor vendor;
  final VoidCallback onTap;

  const _VendorCard({required this.vendor, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(vendor.name, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 14.5)),
                const SizedBox(height: 2),
                Text(
                  [
                    vendor.specialty.isEmpty ? 'No specialty set' : vendor.specialty,
                    if (vendor.phone.isNotEmpty) vendor.phone,
                  ].join(' · '),
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          const Icon(Icons.edit_outlined, size: 17, color: AppTheme.muted),
        ],
      ),
    );
  }
}
