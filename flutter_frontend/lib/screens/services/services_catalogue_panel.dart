import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/constant.dart';
import '../../domain/models/lodge_service.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/lodge_services_viewmodel.dart' show LodgeServicesState;
import '../../widgets/desk_table.dart';
import '../../widgets/h_scroll_table.dart';
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
  // ServicesScreen triggers the initial load once and keeps the provider
  // alive for the life of the screen — see service_usage_panel.dart.

  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(lodgeServicesViewModelProvider);

    if (state.isLoadingServices && state.services.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    final needle = _search.text.trim().toLowerCase();
    final shown = needle.isEmpty ? state.services : state.services.where((s) => s.name.toLowerCase().contains(needle)).toList();

    if (!AppTheme.isPhone(context)) return _desktop(state, shown);

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
              _SearchField(
                controller: _search,
                hint: 'Search services…',
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: AppTheme.s12),
              if (shown.isEmpty)
                NeuNotice(
                  icon: Icons.spa_outlined,
                  message: state.services.isEmpty
                      ? 'No services yet. Add what the lodge offers — private pool, gaming, spa — with a price per use.'
                      : 'Nothing matches this search.',
                )
              else
                for (final s in shown)
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
            backgroundColor: AppTheme.ctaBg(context),
            foregroundColor: AppTheme.ctaFg(context),
            elevation: 2,
            onPressed: () => showServiceFormScreen(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }

  /// Desktop: search and Add service on one toolbar row over a price table.
  Widget _desktop(LodgeServicesState state, List<LodgeService> shown) {
    final notifier = ref.read(lodgeServicesViewModelProvider.notifier);
    final gutter = AppTheme.gutter(context);
    return TablePageBody(
      table: shown.isNotEmpty,
      padding: EdgeInsets.fromLTRB(gutter, AppTheme.s12, gutter, AppTheme.s16),
      children: [
        if (state.error != null) ...[
          _ErrorBanner(state.error!),
          const SizedBox(height: AppTheme.s12),
        ],
        Row(
          children: [
            Expanded(
              child: Align(
                alignment: Alignment.centerLeft,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 460),
                  child: _SearchField(controller: _search, hint: 'Search services…', onChanged: (_) => setState(() {})),
                ),
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            NeuButton(
              primary: true,
              onPressed: () => showServiceFormScreen(context),
              child: const Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.add_rounded, size: 18, color: Colors.white), SizedBox(width: 6), Text('Add service')]),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s12),
        if (shown.isEmpty)
          NeuNotice(
            icon: Icons.spa_outlined,
            message: state.services.isEmpty
                ? 'No services yet. Add what the lodge offers — private pool, gaming, spa — with a price per use.'
                : 'Nothing matches this search.',
          )
        else
          DeskTable(
            columns: const [
              DeskColumn('Service', 260),
              DeskColumn('Price', 110, align: TextAlign.right),
              DeskColumn('Per', 110),
              DeskColumn('GST', 90, align: TextAlign.right, lowPriority: true),
              DeskColumn('Status', 110),
            ],
            actionsWidth: 220,
            rows: [
              for (final s in shown)
                DeskRow(
                  onTap: () => showServiceFormScreen(context, service: s),
                  cells: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (s.image != null) ...[
                          ClipRRect(
                            borderRadius: BorderRadius.circular(AppTheme.rSmall),
                            child: Image.network(
                              '$baseUrl/service-images/${s.image}',
                              width: 28,
                              height: 28,
                              fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => const SizedBox(width: 28, height: 28),
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                        ],
                        Flexible(child: DeskText(s.name, bold: true)),
                      ],
                    ),
                    DeskText(formatPrice(s.price), bold: true),
                    DeskText(s.unitLabel),
                    DeskText('${s.gstRatePercent}%'),
                    StatusPill(label: s.isActive ? 'Active' : 'Inactive', color: s.isActive ? AppTheme.checkedIn : AppTheme.muted),
                  ],
                  actions: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CompactActionButton(label: 'Edit', color: AppTheme.edit, onTap: () => showServiceFormScreen(context, service: s)),
                      const SizedBox(width: 6),
                      CompactActionButton(
                        label: s.isActive ? 'Deactivate' : 'Activate',
                        color: s.isActive ? AppTheme.danger : AppTheme.accent,
                        onTap: () => notifier.toggleActive(s),
                      ),
                    ],
                  ),
                ),
            ],
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
            if (service.image != null) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.rSmall),
                child: Image.network(
                  '$baseUrl/service-images/${service.image}',
                  width: 48,
                  height: 48,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const SizedBox(width: 48, height: 48),
                ),
              ),
              const SizedBox(width: AppTheme.s8),
            ],
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

/// Same pill-shaped search field other list screens use (expenses_list_
/// panel.dart, service_usage_panel.dart) — a circular accent-tinted icon
/// badge, a borderless field, and a clear (×) button once there is
/// something typed.
class _SearchField extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final ValueChanged<String> onChanged;

  const _SearchField({required this.controller, required this.hint, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: AppTheme.searchRadius(context),
        border: AppTheme.searchBorder(context),
        boxShadow: AppTheme.subtle,
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.10), shape: BoxShape.circle),
            child: const Icon(Icons.search_rounded, size: 15, color: AppTheme.accent),
          ),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              style: const TextStyle(color: AppTheme.heading, fontSize: 14),
              decoration: InputDecoration(
                hintText: hint,
                hintStyle: const TextStyle(color: AppTheme.muted, fontSize: 14),
                border: InputBorder.none,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
              ),
            ),
          ),
          if (controller.text.isNotEmpty)
            GestureDetector(
              onTap: () {
                controller.clear();
                onChanged('');
              },
              behavior: HitTestBehavior.opaque,
              child: Container(
                width: 26,
                height: 26,
                margin: const EdgeInsets.only(right: 2),
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: AppTheme.bg, shape: BoxShape.circle),
                child: const Icon(Icons.close_rounded, size: 15, color: AppTheme.muted),
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
