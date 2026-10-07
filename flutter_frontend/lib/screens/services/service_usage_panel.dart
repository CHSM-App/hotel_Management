import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/lodge_service.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'start_usage_screen.dart';

/// Service use — mirrors the 'usage' view in ServicesPanel.jsx: start a
/// service when the guest begins, mark it completed when done, which sends
/// it to Billing > Services to bill.
class ServiceUsagePanel extends ConsumerStatefulWidget {
  const ServiceUsagePanel({super.key});

  @override
  ConsumerState<ServiceUsagePanel> createState() => _ServiceUsagePanelState();
}

class _ServiceUsagePanelState extends ConsumerState<ServiceUsagePanel> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(lodgeServicesViewModelProvider.notifier).loadUsages();
      ref.read(lodgeServicesViewModelProvider.notifier).loadServices();
      ref.read(lodgeServicesViewModelProvider.notifier).loadInHouseGuests();
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(lodgeServicesViewModelProvider);

    if (state.isLoading && state.usages.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(lodgeServicesViewModelProvider.notifier).loadUsages(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (state.error != null) ...[
            _ErrorBanner(state.error!),
            const SizedBox(height: AppTheme.s12),
          ],
          Row(
            children: [
              Expanded(
                child: NeuButton(primary: true, onPressed: () => showStartUsageScreen(context), child: const Text('+ Start a service')),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          const Text(
            'Start a service when the guest begins, mark it completed when done — it then appears in Billing > Services to bill, where it is billed or added to the guest’s room bill.',
            style: TextStyle(color: AppTheme.muted, fontSize: 11.5),
          ),
          const SizedBox(height: AppTheme.s12),
          if (state.usages.isEmpty)
            const NeuNotice(icon: Icons.spa_outlined, message: 'Nothing yet.')
          else
            for (final u in state.usages)
              _UsageCard(
                usage: u,
                onComplete: () => ref.read(lodgeServicesViewModelProvider.notifier).completeUsage(u.id),
                onCancel: () => ref.read(lodgeServicesViewModelProvider.notifier).cancelUsage(u.id),
              ),
        ],
      ),
    );
  }
}

class _UsageCard extends StatelessWidget {
  final ServiceUsage usage;
  final VoidCallback onComplete;
  final VoidCallback onCancel;

  const _UsageCard({required this.usage, required this.onComplete, required this.onCancel});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${usage.serviceName} × ${usage.quantity}', style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13.5)),
                const SizedBox(height: 2),
                Text(usage.detailLine(), style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(formatPrice(usage.lineTotal), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 14)),
              const SizedBox(height: 6),
              Row(
                children: [
                  if (usage.status == 'IN_USE')
                    NeuButton(primary: true, onPressed: onComplete, padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8), child: const Text('Complete', style: TextStyle(fontSize: 12))),
                  if (!usage.billed && usage.status != 'CANCELLED') ...[
                    const SizedBox(width: AppTheme.s8),
                    TextButton(onPressed: onCancel, child: const Text('Cancel', style: TextStyle(color: AppTheme.danger, fontSize: 12))),
                  ],
                ],
              ),
            ],
          ),
        ],
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
      decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
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
