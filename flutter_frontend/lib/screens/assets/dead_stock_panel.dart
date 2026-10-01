import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'asset_detail_screen.dart';
import 'asset_icons.dart';

/// Assets > Dead Stock — mirrors the Dead Stock tab in AssetsPanel.jsx:
/// every retired asset with when it died, why, how it was disposed of, and
/// anything recovered. Read-only here; retiring (and correcting a dead
/// stock record) happens from the asset's own detail screen, same as the
/// web keeps it a side effect of the status picker rather than a separate
/// "add" flow on this tab.
class DeadStockPanel extends ConsumerWidget {
  const DeadStockPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(assetsViewModelProvider);
    final deadStock = [...state.deadStockAssets]..sort((a, b) => (b.deadDate ?? '').compareTo(a.deadDate ?? ''));

    return RefreshIndicator(
      onRefresh: () => ref.read(assetsViewModelProvider.notifier).loadAssets(includeInactive: true),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (state.isLoading && deadStock.isEmpty)
            const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
          else if (deadStock.isEmpty)
            const NeuNotice(
              icon: Icons.delete_sweep_outlined,
              message:
                  'Nothing here yet. Retiring an asset from the Asset Register logs it here with when it died, why, how it was disposed of, and anything recovered.',
            )
          else
            for (final a in deadStock)
              Padding(
                padding: const EdgeInsets.only(bottom: AppTheme.s8),
                child: _DeadStockCard(
                  asset: a,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => AssetDetailScreen(assetId: a.id)),
                  ),
                ),
              ),
        ],
      ),
    );
  }
}

class _DeadStockCard extends StatelessWidget {
  final Asset asset;
  final VoidCallback onTap;

  const _DeadStockCard({required this.asset, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          IconBadge(icon: categoryIcon(asset.categoryName), color: AppTheme.muted, size: 42),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        asset.name,
                        style: Theme.of(context).textTheme.titleSmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (asset.assetTag != null) ...[
                      const SizedBox(width: 6),
                      Text(asset.assetTag!, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                    ],
                  ],
                ),
                const SizedBox(height: 4),
                _row('Dead since', asset.deadDate != null ? formatIsoDate(asset.deadDate!) : '—'),
                _row('Reason', (asset.deadReason ?? '').isEmpty ? '—' : asset.deadReason!),
                _row('Disposal', (asset.disposalNote ?? '').isEmpty ? '—' : asset.disposalNote!),
                _row('Recovery', asset.recoveryCost != null ? formatPrice(asset.recoveryCost) : '—'),
                _row('Handled by', (asset.disposedBy ?? '').isEmpty ? '—' : asset.disposedBy!),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
    padding: const EdgeInsets.only(top: 2),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 78, child: Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5))),
        Expanded(child: Text(value, style: const TextStyle(color: AppTheme.text, fontSize: 12.5), maxLines: 2, overflow: TextOverflow.ellipsis)),
      ],
    ),
  );
}
