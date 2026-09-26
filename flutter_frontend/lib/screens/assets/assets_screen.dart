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
          child: _SubTabs(selected: _tab, onSelect: (t) => setState(() => _tab = t)),
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

/// Same sliding-pill segmented control the Rooms & Rates / Billing screens
/// use — one connected control with a moving highlight, rather than a
/// content-hugging pill row.
class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const _tabs = {
    'assets': 'Asset Register',
    'workOrders': 'Work Orders',
    'vendors': 'Vendors',
  };

  static const double _height = 44;

  @override
  Widget build(BuildContext context) {
    final keys = _tabs.keys.toList();
    final selectedIndex = keys.indexOf(selected).clamp(0, keys.length - 1);

    Widget segment(String key, String label) {
      final isSelected = key == selected;
      return Expanded(
        child: GestureDetector(
          onTap: () => onSelect(key),
          behavior: HitTestBehavior.opaque,
          child: SizedBox(
            height: _height,
            child: Center(
              child: AnimatedDefaultTextStyle(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeOut,
                style: TextStyle(
                  color: isSelected ? Colors.white : AppTheme.text,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                  fontSize: 13,
                ),
                child: Text(label, overflow: TextOverflow.ellipsis),
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      height: _height,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Stack(
        children: [
          AnimatedAlign(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            alignment: Alignment(
              -1 + (2 / (keys.length - 1)) * selectedIndex,
              0,
            ),
            child: FractionallySizedBox(
              widthFactor: 1 / keys.length,
              child: Container(
                height: _height - 8,
                decoration: BoxDecoration(
                  color: AppTheme.accent,
                  borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
                ),
              ),
            ),
          ),
          Row(
            children: [
              for (final entry in _tabs.entries) segment(entry.key, entry.value),
            ],
          ),
        ],
      ),
    );
  }
}
