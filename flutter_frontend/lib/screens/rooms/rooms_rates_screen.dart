import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/rooms_viewmodel.dart';
import '../../widgets/neu.dart';
import '../../widgets/pill_tabs.dart';
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
        PillTab('rooms', 'Rooms', Icons.bed_rounded),
        PillTab('chart', 'Price chart', Icons.price_change_rounded),
        PillTab('simulator', 'Simulator', Icons.calculate_rounded),
        PillTab('checkout', 'Checkout policy', Icons.logout_rounded),
      ],
    );
  }
}
