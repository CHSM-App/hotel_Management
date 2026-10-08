import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/lodge_service.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../housekeeping/housekeeping_parts.dart';
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
  // ServicesScreen triggers the initial loadUsages/loadServices/
  // loadInHouseGuests once, and keeps lodgeServicesViewModelProvider alive
  // for as long as the screen is open — switching sub-tabs here no longer
  // needs (or should repeat) its own load.

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(lodgeServicesViewModelProvider);

    if (state.isLoadingUsages && state.usages.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(lodgeServicesViewModelProvider.notifier).loadUsages(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s32 + 56),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              if (state.error != null) ...[
                _ErrorBanner(state.error!),
                const SizedBox(height: AppTheme.s12),
              ],
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
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            elevation: 2,
            onPressed: () => showStartUsageScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
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
    final tone = switch (usage.status) {
      'IN_USE' => AppTheme.edit,
      'CANCELLED' => AppTheme.danger,
      _ => usage.billed ? AppTheme.muted : AppTheme.checkedIn,
    };
    // Room / guest / billing note, without the status — the status gets its
    // own pill instead of sitting inline in the text.
    final meta = [
      if (usage.roomNumber != null) 'Room ${usage.roomNumber}',
      if (usage.guestName != null && usage.guestName!.isNotEmpty) usage.guestName!,
      if (usage.status == 'COMPLETED') (usage.billed ? 'billed' : (usage.onRoomBill ? 'on room bill' : 'ready to bill')),
    ].join(' · ');
    final showActions = usage.status == 'IN_USE' || (!usage.billed && usage.status != 'CANCELLED');

    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.extruded,
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.s8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${usage.serviceName} × ${usage.quantity}', style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      StatusPill(label: kServiceUsageStatusLabel[usage.status] ?? usage.status, color: tone),
                      if (meta.isNotEmpty) ...[
                        const SizedBox(width: 6),
                        Expanded(child: Text(meta, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5), maxLines: 1, overflow: TextOverflow.ellipsis)),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(formatPrice(usage.lineTotal), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 14)),
                if (showActions) ...[
                  const SizedBox(height: 6),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (usage.status == 'IN_USE')
                        CompactActionButton(label: 'Complete', color: AppTheme.accent, primary: true, onTap: onComplete),
                      if (!usage.billed && usage.status != 'CANCELLED') ...[
                        const SizedBox(width: 6),
                        CompactActionButton(label: 'Cancel', color: AppTheme.danger, onTap: onCancel),
                      ],
                    ],
                  ),
                ],
              ],
            ),
          ],
        ),
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
