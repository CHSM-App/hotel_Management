import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'asset_detail_screen.dart';

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
    final chips = <Widget>[
      if ((asset.deadReason ?? '').isNotEmpty) _chip('Reason', asset.deadReason!),
      if ((asset.disposalNote ?? '').isNotEmpty) _chip('Disposal', asset.disposalNote!),
      if (asset.recoveryCost != null && asset.recoveryCost! > 0)
        _chip('Recovered', formatPrice(asset.recoveryCost), accent: true),
      if ((asset.disposedBy ?? '').isNotEmpty) _chip('By', asset.disposedBy!),
    ];

    return NeuCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8 + 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: asset.name, style: Theme.of(context).textTheme.titleSmall),
                      if (asset.assetTag != null)
                        TextSpan(
                          text: '   ${asset.assetTag}',
                          style: const TextStyle(color: AppTheme.muted, fontSize: 11, fontWeight: FontWeight.w500),
                        ),
                    ],
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Text(
                asset.deadDate != null ? formatIsoDate(asset.deadDate!) : '—',
                style: const TextStyle(color: AppTheme.muted, fontSize: 11, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          if (chips.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: chips),
          ],
        ],
      ),
    );
  }

  Widget _chip(String label, String value, {bool accent = false}) => ConstrainedBox(
    constraints: const BoxConstraints(maxWidth: 220),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: accent ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$label · $value',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: accent ? AppTheme.accent : AppTheme.text,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
  );
}
