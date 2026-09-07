import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/rooms_viewmodel.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'price_chart_panel.dart';
import 'rooms_panel.dart';

/// Rooms & rates: the same page the web dashboard puts under that name, with
/// the same two halves — the rooms themselves, and the rate chart that prices
/// them (categories, booking extras, seasons).
///
/// One screen with an internal switch rather than two bottom-bar tabs: the
/// bar only has room for so many destinations (see kPrimaryTabs), and rates
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
    return _tab == 'rooms' ? const RoomsPanel() : const PriceChartPanel();
  }
}

class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const _tabs = {'rooms': 'Rooms', 'chart': 'Price chart'};

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final entry in _tabs.entries) ...[
          Expanded(
            child: GestureDetector(
              onTap: () => onSelect(entry.key),
              child: entry.key == selected
                  ? NeuPressed(
                      radius: AppTheme.rMedium,
                      padding: const EdgeInsets.symmetric(
                        vertical: AppTheme.s12,
                      ),
                      child: Center(
                        child: Text(
                          entry.value,
                          style: const TextStyle(
                            color: AppTheme.accent,
                            fontWeight: FontWeight.w500,
                            fontSize: 14,
                          ),
                        ),
                      ),
                    )
                  : NeuCard(
                      radius: AppTheme.rMedium,
                      shadow: AppTheme.subtle,
                      padding: const EdgeInsets.symmetric(
                        vertical: AppTheme.s12,
                      ),
                      child: Center(
                        child: Text(
                          entry.value,
                          style: const TextStyle(
                            color: AppTheme.text,
                            fontSize: 14,
                          ),
                        ),
                      ),
                    ),
            ),
          ),
          if (entry.key != _tabs.keys.last)
            const SizedBox(width: AppTheme.s8),
        ],
      ],
    );
  }
}
