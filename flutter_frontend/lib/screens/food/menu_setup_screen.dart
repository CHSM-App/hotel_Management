import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../theme.dart';
import 'food_settings_panel.dart';
import 'inventory_panel.dart';
import 'menu_panel.dart';
import 'qr_codes_panel.dart';
import 'recipes_panel.dart';
import 'tables_panel.dart';

/// Menu & QR codes — the six sub-tabs FoodSetup.jsx hosts, in the same order
/// and behind the same conditional: Tables only appears once the property has
/// switched dining-table ordering on, read live off [Me] rather than fixed at
/// mount, exactly like the web reading `lodge?.foodTableService` on every
/// render.
class MenuSetupScreen extends ConsumerStatefulWidget {
  const MenuSetupScreen({super.key});

  @override
  ConsumerState<MenuSetupScreen> createState() => _MenuSetupScreenState();
}

class _MenuSetupScreenState extends ConsumerState<MenuSetupScreen> {
  String _tab = 'menu';

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(authViewModelProvider).me;
    final tableServiceOn = me?.lodge.foodTableService ?? false;

    final tabs = <_Tab>[
      const _Tab('menu', 'Menu'),
      const _Tab('recipes', 'Recipes'),
      const _Tab('inventory', 'Inventory'),
      if (tableServiceOn) const _Tab('tables', 'Tables'),
      const _Tab('qr', 'QR codes'),
      const _Tab('settings', 'Settings'),
    ];
    final active = tabs.any((t) => t.key == _tab) ? _tab : 'menu';

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s8),
          child: _SubTabs(
            tabs: tabs,
            selected: active,
            onSelect: (t) => setState(() => _tab = t),
          ),
        ),
        Expanded(child: _body(active)),
      ],
    );
  }

  Widget _body(String tab) {
    switch (tab) {
      case 'recipes':
        return const RecipesPanel();
      case 'inventory':
        return const InventoryPanel();
      case 'tables':
        return const TablesPanel();
      case 'qr':
        return const QrCodesPanel();
      case 'settings':
        return const FoodSettingsPanel();
      case 'menu':
      default:
        return const MenuPanel();
    }
  }
}

class _Tab {
  final String key;
  final String label;
  const _Tab(this.key, this.label);
}

/// A horizontally scrolling pill strip — six labels don't fit the fixed
/// segmented control Rooms & rates uses for its two, so this scrolls instead
/// of squeezing "Inventory" and "Settings" down to nothing.
class _SubTabs extends StatelessWidget {
  final List<_Tab> tabs;
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.tabs, required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: tabs.length,
        separatorBuilder: (_, __) => const SizedBox(width: AppTheme.s8),
        itemBuilder: (context, i) {
          final t = tabs[i];
          final isSelected = t.key == selected;
          return GestureDetector(
            onTap: () => onSelect(t.key),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: isSelected ? AppTheme.accent : AppTheme.card,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: isSelected ? AppTheme.accent : AppTheme.border),
              ),
              child: Text(
                t.label,
                style: TextStyle(
                  color: isSelected ? Colors.white : AppTheme.text,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                  fontSize: 13,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
