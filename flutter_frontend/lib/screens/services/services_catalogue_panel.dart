import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
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

    return RefreshIndicator(
      onRefresh: () => ref.read(lodgeServicesViewModelProvider.notifier).loadServices(),
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
                child: NeuButton(primary: true, onPressed: () => showServiceFormScreen(context), child: const Text('+ Add service')),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          if (state.services.isEmpty)
            NeuNotice(
              icon: Icons.spa_outlined,
              message: 'No services yet. Add what the lodge offers — private pool, gaming, spa — with a price per use.',
            )
          else
            for (final s in state.services)
              NeuCard(
                margin: const EdgeInsets.only(bottom: AppTheme.s8),
                child: Opacity(
                  opacity: s.isActive ? 1 : 0.55,
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(s.name, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14)),
                            const SizedBox(height: 2),
                            Text('${formatPrice(s.price)} per ${s.unitLabel} · GST ${s.gstRatePercent}% included', style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                          ],
                        ),
                      ),
                      TextButton(onPressed: () => showServiceFormScreen(context, service: s), child: const Text('Edit')),
                      TextButton(
                        onPressed: () => ref.read(lodgeServicesViewModelProvider.notifier).toggleActive(s),
                        child: Text(s.isActive ? 'Deactivate' : 'Activate'),
                      ),
                    ],
                  ),
                ),
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
