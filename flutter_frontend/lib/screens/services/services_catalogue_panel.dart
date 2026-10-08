import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/lodge_service.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../housekeeping/housekeeping_parts.dart';
import '../theme.dart';
import 'service_form_screen.dart';

/// Services & prices — mirrors the 'catalogue' view in ServicesPanel.jsx.
class ServicesCataloguePanel extends ConsumerStatefulWidget {
  const ServicesCataloguePanel({super.key});

  @override
  ConsumerState<ServicesCataloguePanel> createState() => _ServicesCataloguePanelState();
}

class _ServicesCataloguePanelState extends ConsumerState<ServicesCataloguePanel> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(lodgeServicesViewModelProvider.notifier).loadServices());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(lodgeServicesViewModelProvider);

    if (state.isLoading && state.services.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(lodgeServicesViewModelProvider.notifier).loadServices(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s32 + 56),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              if (state.error != null) ...[
                _ErrorBanner(state.error!),
                const SizedBox(height: AppTheme.s12),
              ],
              if (state.services.isEmpty)
                NeuNotice(
                  icon: Icons.spa_outlined,
                  message: 'No services yet. Add what the lodge offers — private pool, gaming, spa — with a price per use.',
                )
              else
                for (final s in state.services)
                  _ServiceCard(
                    service: s,
                    onEdit: () => showServiceFormScreen(context, service: s),
                    onToggleActive: () => ref.read(lodgeServicesViewModelProvider.notifier).toggleActive(s),
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
            onPressed: () => showServiceFormScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _ServiceCard extends StatelessWidget {
  final LodgeService service;
  final VoidCallback onEdit;
  final VoidCallback onToggleActive;

  const _ServiceCard({required this.service, required this.onEdit, required this.onToggleActive});

  @override
  Widget build(BuildContext context) {
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
                  Row(
                    children: [
                      Expanded(
                        child: Text(service.name, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                      if (!service.isActive) ...[
                        const SizedBox(width: 6),
                        const StatusPill(label: 'Inactive', color: AppTheme.muted),
                      ],
                    ],
                  ),
                  const SizedBox(height: 5),
                  Text('${formatPrice(service.price)} per ${service.unitLabel} · GST ${service.gstRatePercent}% included', style: const TextStyle(color: AppTheme.muted, fontSize: 11.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                CompactActionButton(label: 'Edit', color: AppTheme.edit, onTap: onEdit),
                const SizedBox(width: 6),
                CompactActionButton(label: service.isActive ? 'Deactivate' : 'Activate', color: service.isActive ? AppTheme.danger : AppTheme.accent, onTap: onToggleActive),
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
