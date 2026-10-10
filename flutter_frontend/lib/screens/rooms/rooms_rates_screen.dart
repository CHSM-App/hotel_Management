import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/rooms_viewmodel.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'checkout_policy_panel.dart';
import 'price_chart_panel.dart';
import 'price_simulator_panel.dart';
import 'rooms_panel.dart';

/// Rooms & rates: the same page the web dashboard puts under that name, with
/// the same two halves — the rooms themselves, and the rate chart that prices
/// them (categories, booking extras, seasons).
///
/// One screen with an internal switch rather than two sidebar sections: rates
/// are something the owner sets up occasionally, not a place reception lives
/// day to day — it belongs behind the section that owns it, not beside it.
class RoomsRatesScreen extends ConsumerStatefulWidget {
  const RoomsRatesScreen({super.key});

  @override
  ConsumerState<RoomsRatesScreen> createState() => _RoomsRatesScreenState();
}

class _RoomsRatesScreenState extends ConsumerState<RoomsRatesScreen> {
  String _tab = 'rooms';

  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(roomsViewModelProvider.notifier).loadAll(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(roomsViewModelProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s16,
            AppTheme.s8,
            AppTheme.s16,
            AppTheme.s8,
          ),
          child: _SubTabs(
            selected: _tab,
            onSelect: (t) => setState(() => _tab = t),
          ),
        ),
        Expanded(child: _body(state)),
      ],
    );
  }

  Widget _body(RoomsState state) {
    if (state.isLoading && state.rooms.isEmpty && state.categories.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.error != null && state.rooms.isEmpty && state.categories.isEmpty) {
      return NeuNotice(
        icon: Icons.cloud_off_rounded,
        message: state.error!,
        action: NeuButton(
          onPressed: () => ref.read(roomsViewModelProvider.notifier).loadAll(),
          child: const Text('Try again'),
        ),
      );
    }
    return switch (_tab) {
      'rooms' => const RoomsPanel(),
      'chart' => const PriceChartPanel(),
      'simulator' => const PriceSimulatorPanel(),
      _ => const CheckoutPolicyPanel(),
    };
  }
}

/// Same sliding-pill segmented control the billing screen's To-bill/Issued
/// switch uses — one connected control with a moving highlight, rather than
/// two separate boxes that don't read as a single tab bar.
class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const _tabs = {
    'rooms': 'Rooms',
    'chart': 'Price chart',
    'simulator': 'Simulator',
    'checkout': 'Checkout policy',
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
                  color: isSelected ? Colors.white : AppTheme.heading,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
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
          // Same gradient "glow" pill the billing screen's To-bill/Issued
          // switch uses, rather than a flat card — a selected tab should
          // read as the clear active one at a glance, not just slightly
          // lighter than the rest.
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
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppTheme.accent, AppTheme.sidebarBrand],
                  ),
                  borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.accent.withValues(alpha: 0.35),
                      blurRadius: 10,
                      offset: const Offset(0, 3),
                    ),
                  ],
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
