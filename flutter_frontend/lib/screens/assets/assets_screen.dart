import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'assets_list_panel.dart';
import 'dead_stock_panel.dart';
import 'depreciation_panel.dart';
import 'vendors_panel.dart';
import 'work_orders_panel.dart';

/// Asset inventory — mirrors AssetsPanel.jsx's shell: the same five tabs,
/// Asset Register / Work Orders / Vendors / Dead Stock / Depreciation.
/// There is no separate "Setup" tab on the web app — categories are named
/// inline from the register form's own Category field.
class AssetsScreen extends ConsumerStatefulWidget {
  const AssetsScreen({super.key});

  @override
  ConsumerState<AssetsScreen> createState() => _AssetsScreenState();
}

class _AssetsScreenState extends ConsumerState<AssetsScreen> {
  String _tab = 'assets';

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      ref.read(assetsViewModelProvider.notifier).loadCatalogue();
      ref.read(assetsViewModelProvider.notifier).loadAssets(includeInactive: true);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s8),
          child: _SubTabs(selected: _tab, onSelect: (t) => setState(() => _tab = t)),
        ),
        Expanded(
          child: switch (_tab) {
            'workOrders' => const WorkOrdersPanel(),
            'vendors' => const VendorsPanel(),
            'deadStock' => const DeadStockPanel(),
            'depreciation' => const DepreciationPanel(),
            _ => const AssetsListPanel(),
          },
        ),
      ],
    );
  }
}

class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return PillTabs(
      selected: selected,
      onSelect: onSelect,
      tabs: const [
        PillTab('assets', 'Asset Register', Icons.inventory_2_rounded),
        PillTab('workOrders', 'Work Orders', Icons.build_rounded),
        PillTab('vendors', 'Vendors', Icons.storefront_rounded),
        PillTab('deadStock', 'Dead Stock', Icons.delete_sweep_rounded),
        PillTab('depreciation', 'Depreciation', Icons.trending_down_rounded),
      ],
    );
  }
}
