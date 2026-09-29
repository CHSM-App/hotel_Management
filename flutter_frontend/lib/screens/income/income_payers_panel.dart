import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart' show Vendor;
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'payer_form_screen.dart';

/// Income > Payers — mirrors the Payers tab in IncomePanel.jsx: a plain list,
/// tap to edit. Same shared dbo.vendors directory Expenses' own Vendors tab
/// edits — a payer added here shows up there too.
class IncomePayersPanel extends ConsumerWidget {
  const IncomePayersPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(incomeViewModelProvider);
    final payers = state.payers;

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(incomeViewModelProvider.notifier).loadCatalogue(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              if (state.catalogueLoading && payers.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (payers.isEmpty)
                const NeuNotice(icon: Icons.person_outline_rounded, message: 'No payers yet. Add anyone who regularly pays the property.')
              else
                for (final v in payers)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppTheme.s8),
                    child: _PayerCard(payer: v, onTap: () => showPayerFormScreen(context, payer: v)),
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
            onPressed: () => showPayerFormScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _PayerCard extends StatelessWidget {
  final Vendor payer;
  final VoidCallback onTap;

  const _PayerCard({required this.payer, required this.onTap});

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
                Text(payer.name, style: Theme.of(context).textTheme.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(
                  [
                    payer.specialty.isEmpty ? 'No specialty set' : payer.specialty,
                    if (payer.phone.isNotEmpty) payer.phone,
                  ].join(' · '),
                  style: Theme.of(context).textTheme.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
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
