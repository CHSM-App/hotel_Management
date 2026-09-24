import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../theme.dart';
import 'assets_list_panel.dart';
import 'vendors_panel.dart';
import 'work_orders_panel.dart';

/// Asset inventory — mirrors AssetsPanel.jsx's shell: the same three tabs,
/// Asset Register / Work Orders / Vendors. There is no separate "Setup" tab
/// on the web app — categories are named inline from the register form's
/// own Category field, so Vendors is the only thing with a tab of its own.
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
    Future.microtask(() => ref.read(assetsViewModelProvider.notifier).loadCatalogue());
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s8),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: _SubTabs(selected: _tab, onSelect: (t) => setState(() => _tab = t)),
          ),
        ),
        Expanded(
          child: switch (_tab) {
            'workOrders' => const WorkOrdersPanel(),
            'vendors' => const VendorsPanel(),
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

  static const _tabs = [
    ('assets', 'Asset Register'),
    ('workOrders', 'Work Orders'),
    ('vendors', 'Vendors'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final t in _tabs)
            GestureDetector(
              onTap: () => onSelect(t.$1),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
                decoration: BoxDecoration(
                  color: t.$1 == selected ? AppTheme.accent : Colors.transparent,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  t.$2,
                  style: TextStyle(
                    color: t.$1 == selected ? Colors.white : AppTheme.text,
                    fontWeight: t.$1 == selected ? FontWeight.w600 : FontWeight.w500,
                    fontSize: 12.5,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
