import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
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

/// A horizontally scrolling pill row — five labels (Asset Register …
/// Depreciation) don't fit as equal-width segments on a phone the way the
/// three-tab sliding control on Rooms & Rates / Billing does, so each pill
/// sizes to its own label instead and the row scrolls.
class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const _tabs = {
    'assets': 'Asset Register',
    'workOrders': 'Work Orders',
    'vendors': 'Vendors',
    'deadStock': 'Dead Stock',
    'depreciation': 'Depreciation',
  };

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final entry in _tabs.entries) ...[
            _Pill(label: entry.value, selected: entry.key == selected, onTap: () => onSelect(entry.key)),
            const SizedBox(width: AppTheme.s8),
          ],
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _Pill({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        height: 40,
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent : AppTheme.bg,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: selected ? AppTheme.accent : AppTheme.border),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            color: selected ? Colors.white : AppTheme.text,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}
