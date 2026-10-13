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

/// Same scrollable pill-strip the billing screen's tab toggle uses — each
/// segment sized to its own label (not an equal Expanded split), so a long
/// label like "Checkout policy" never gets truncated on a narrow phone. The
/// strip scrolls sideways when the segments don't all fit, with an edge fade
/// showing there's more past either side, and the selected tab is scrolled
/// into view whenever it changes.
class _SubTabs extends StatefulWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const _tabs = {
    'rooms': 'Rooms',
    'chart': 'Price chart',
    'simulator': 'Simulator',
    'checkout': 'Checkout policy',
  };

  @override
  State<_SubTabs> createState() => _SubTabsState();
}

class _SubTabsState extends State<_SubTabs> {
  static const double _height = 40;

  final _scroll = ScrollController();
  final Map<String, GlobalKey> _segmentKeys = {};

  GlobalKey _keyFor(String key) =>
      _segmentKeys.putIfAbsent(key, () => GlobalKey());

  bool _moreLeft = false;
  bool _moreRight = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_updateEdges);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _updateEdges();
      _scrollToSelected(animate: false);
    });
  }

  @override
  void didUpdateWidget(covariant _SubTabs old) {
    super.didUpdateWidget(old);
    WidgetsBinding.instance.addPostFrameCallback((_) => _updateEdges());
    if (old.selected != widget.selected) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _scrollToSelected(),
      );
    }
  }

  @override
  void dispose() {
    _scroll.removeListener(_updateEdges);
    _scroll.dispose();
    super.dispose();
  }

  void _updateEdges() {
    if (!_scroll.hasClients) return;
    final pos = _scroll.position;
    final moreLeft = pos.pixels > 2;
    final moreRight = pos.pixels < pos.maxScrollExtent - 2;
    if (moreLeft != _moreLeft || moreRight != _moreRight) {
      setState(() {
        _moreLeft = moreLeft;
        _moreRight = moreRight;
      });
    }
  }

  void _scrollToSelected({bool animate = true}) {
    final context = _segmentKeys[widget.selected]?.currentContext;
    if (context == null) return;
    Scrollable.ensureVisible(
      context,
      duration: animate ? const Duration(milliseconds: 220) : Duration.zero,
      curve: Curves.easeOut,
      alignment: 0.5,
    );
  }

  @override
  Widget build(BuildContext context) {
    Widget segment(String key, String label) {
      final isSelected = key == widget.selected;
      return GestureDetector(
        key: _keyFor(key),
        onTap: () => widget.onSelect(key),
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
          height: _height - 8,
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: isSelected
                ? const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppTheme.accent, AppTheme.sidebarBrand],
                  )
                : null,
            borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: AppTheme.accent.withValues(alpha: 0.35),
                      blurRadius: 10,
                      offset: const Offset(0, 3),
                    ),
                  ]
                : null,
          ),
          child: AnimatedDefaultTextStyle(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            style: TextStyle(
              color: isSelected ? Colors.white : AppTheme.heading,
              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
              fontSize: 13,
            ),
            child: Text(label, maxLines: 1, softWrap: false),
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
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
        child: Stack(
          children: [
            NotificationListener<ScrollMetricsNotification>(
              onNotification: (_) {
                WidgetsBinding.instance.addPostFrameCallback(
                  (_) => _updateEdges(),
                );
                return false;
              },
              child: SingleChildScrollView(
                controller: _scroll,
                scrollDirection: Axis.horizontal,
                physics: const ClampingScrollPhysics(),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final entry in _SubTabs._tabs.entries) ...[
                      segment(entry.key, entry.value),
                      const SizedBox(width: 4),
                    ],
                  ],
                ),
              ),
            ),
            if (_moreLeft) const _EdgeFade(alignment: Alignment.centerLeft),
            if (_moreRight) const _EdgeFade(alignment: Alignment.centerRight),
          ],
        ),
      ),
    );
  }
}

/// A faded strip at one edge of the tab row — the visual cue that there is
/// more to scroll to past that edge. `IgnorePointer`ed so it never steals
/// the tap meant for the segment under it.
class _EdgeFade extends StatelessWidget {
  final Alignment alignment;

  const _EdgeFade({required this.alignment});

  @override
  Widget build(BuildContext context) {
    final fromLeft = alignment == Alignment.centerLeft;
    return Positioned(
      left: fromLeft ? 0 : null,
      right: fromLeft ? null : 0,
      top: 0,
      bottom: 0,
      child: IgnorePointer(
        child: Container(
          width: 18,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: fromLeft ? Alignment.centerLeft : Alignment.centerRight,
              end: fromLeft ? Alignment.centerRight : Alignment.centerLeft,
              colors: [AppTheme.bg, AppTheme.bg.withValues(alpha: 0)],
            ),
          ),
        ),
      ),
    );
  }
}
