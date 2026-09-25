import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/me.dart';
import '../../presentation/providers/network_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../assets/assets_screen.dart';
import '../billing/billing_screen.dart';
import '../bookings/bookings_screen.dart';
import '../bookings/register_screen.dart';
import '../events/events_screen.dart';
import '../expenses/expenses_screen.dart';
import '../food/menu_setup_screen.dart';
import '../food/orders_screen.dart';
import '../placeholder_screen.dart';
import '../profile/profile_screen.dart';
// import '../reports/reports_screen.dart';
import '../rooms/rooms_rates_screen.dart';
import '../theme.dart';
import 'feature.dart';

/// The signed-in app: a top bar, a section, and the bottom bar that chooses it.
///
/// The web dashboard puts its eight sections in a sidebar. A phone has no
/// sidebar, so the four the desk touches all day get their own tab and the rest
/// fold into More — the split is by how often a section is opened, not by the
/// sidebar's own grouping, because a bottom bar is a set of destinations rather
/// than a menu.
class DashboardShell extends ConsumerStatefulWidget {
  const DashboardShell({super.key});

  @override
  ConsumerState<DashboardShell> createState() => _DashboardShellState();
}

/// Not a real feature key — selects the inline "More" list rather than any
/// [Feature], the same way `_section` selects any other tab's screen.
const _kMoreKey = '__more__';

class _DashboardShellState extends ConsumerState<DashboardShell> {
  String? _section;

  @override
  void initState() {
    super.initState();
    // Never synchronously in initState — the provider is not ready to be
    // written to during the first build.
    Future.microtask(() => ref.read(authViewModelProvider.notifier).loadMe());
  }

  /// True once the desk has followed the More list into Rooms & rates or
  /// Menu & QR codes. Those screens then take the whole page — no top bar,
  /// no bottom bar, just their own back row — the same way a pushed page
  /// would, since nothing about the outer shell's chrome applies to a
  /// destination that isn't one of its own bottom-bar tabs.
  bool _inOverflowScreen(Me? me) {
    if (me == null || _section == null || _section == _kMoreKey) return false;
    final features = kFeatures.where((f) => f.availableTo(me)).toList();
    return features.skip(kPrimaryTabs).any((f) => f.key == _section);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authViewModelProvider);
    final me = state.me;
    final fullScreen = _inOverflowScreen(me);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle(
        statusBarColor: fullScreen ? AppTheme.bg : AppTheme.accent,
        statusBarIconBrightness: Brightness.light,
        statusBarBrightness: Brightness.dark,
      ),
      child: Scaffold(
        body: Column(
          children: [
            if (!fullScreen) _TopBar(me: me),
            if (!fullScreen) const _OfflineBanner(),
            Expanded(
              child: SafeArea(
                top: fullScreen,
                bottom: false,
                child: _body(state.isLoading, state.error, me),
              ),
            ),
          ],
        ),
        bottomNavigationBar: (me == null || fullScreen) ? null : _bottomBar(me),
      ),
    );
  }

  Widget _body(bool loading, String? error, Me? me) {
    if (me == null) {
      if (loading) {
        return const Center(child: CircularProgressIndicator());
      }
      return NeuNotice(
        message: error ?? 'Could not load your lodge.',
        icon: Icons.cloud_off_rounded,
        action: NeuButton(
          onPressed: () =>
              ref.read(authViewModelProvider.notifier).loadMe(),
          child: const Text('Try again'),
        ),
      );
    }

    final features = kFeatures.where((f) => f.availableTo(me)).toList();
    if (features.isEmpty) {
      return const NeuNotice(
        message: 'This login cannot reach any section yet.\n'
            'Ask the owner to grant it a role.',
        icon: Icons.lock_outline_rounded,
      );
    }

    if (_section == _kMoreKey) {
      final overflow = features.skip(kPrimaryTabs).toList();
      return _MoreList(
        features: overflow,
        onSelect: (key) => setState(() => _section = key),
      );
    }

    final active = features.firstWhere(
      (f) => f.key == _section,
      orElse: () => features.first,
    );

    Widget screen;
    switch (active.key) {
      case 'bookings':
        screen = const BookingsScreen();
      case 'register':
        screen = const RegisterScreen();
      case 'food':
        screen = const OrdersScreen();
      case 'billing':
        screen = const BillingScreen();
      case 'rooms':
        screen = const RoomsRatesScreen();
      case 'menu':
        screen = const MenuSetupScreen();
      case 'events':
        screen = const EventsScreen();
      case 'assets':
        screen = const AssetsScreen();
      case 'expenses':
        screen = const ExpensesScreen();
      // case 'reports':
      //   screen = const ReportsScreen();
      default:
        // Every other section is deliberately still a stub — see the file.
        screen = PlaceholderScreen(feature: active);
    }

    // Rooms & rates and Menu & QR codes only ever arrive from the More list,
    // never from their own bottom-bar tab, so nothing else lets the desk get
    // back to that list once inside one — a back row does the one thing a
    // pushed page's AppBar would have, without turning this into a real
    // Navigator.push (which would fight the tab bar's own section switching).
    final cameFromMore = features.skip(kPrimaryTabs).any((f) => f.key == active.key);
    if (!cameFromMore) return screen;

    return Column(
      children: [
        _BackToMoreRow(
          title: active.title,
          onBack: () => setState(() => _section = _kMoreKey),
        ),
        Expanded(child: screen),
      ],
    );
  }

  Widget _bottomBar(Me me) {
    final features = kFeatures.where((f) => f.availableTo(me)).toList();
    if (features.isEmpty) return const SizedBox.shrink();

    final primary = features.take(kPrimaryTabs).toList();
    final overflow = features.skip(kPrimaryTabs).toList();

    final onMoreList = _section == _kMoreKey;
    final active = onMoreList
        ? null
        : features.firstWhere(
            (f) => f.key == _section,
            orElse: () => features.first,
          );
    final activeIsOverflow =
        onMoreList || overflow.any((f) => f.key == active?.key);

    return Container(
      decoration: const BoxDecoration(
        color: AppTheme.bg,
        boxShadow: [
          BoxShadow(
            color: AppTheme.shadowDark,
            offset: Offset(0, -3),
            blurRadius: 8,
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppTheme.s8,
            vertical: 4,
          ),
          // The row is held to the height of a tab and no more.
          //
          // Without this it grew to fill the whole screen: the bottom bar slot
          // is given loose constraints, a Row's cross-axis default is stretch,
          // and _Tab is a Container with a minHeight and no maximum — so every
          // tab happily took 600px, the bar took the lot, and the body was left
          // with nothing. Which is why the app looked like a navbar floating in
          // the middle of an empty page rather than like an error.
          //
          // IntrinsicHeight (rather than a guessed fixed height) sizes the row
          // to whatever the tabs actually need, so it doesn't overflow when
          // text scale or label length pushes a tab taller than a hardcoded
          // number would allow.
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final f in primary)
                  Expanded(
                    child: _Tab(
                      icon: f.icon,
                      label: f.tabLabel,
                      selected: !activeIsOverflow && f.key == active?.key,
                      onTap: () => setState(() => _section = f.key),
                    ),
                  ),
                if (overflow.isNotEmpty)
                  Expanded(
                    child: _Tab(
                      icon: Icons.more_horiz_rounded,
                      label: 'More',
                      selected: activeIsOverflow,
                      onTap: () => setState(() => _section = _kMoreKey),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

}

/// The body shown for the "More" tab: the features that didn't fit on the
/// bottom bar, listed the same way any other section fills this space —
/// tapping one just switches `_section` like any other tab does, rather than
/// opening a sheet or pushing a page.
class _MoreList extends StatelessWidget {
  final List<Feature> features;
  final ValueChanged<String> onSelect;

  const _MoreList({required this.features, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppTheme.s16),
      children: [
        for (final f in features)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s12),
            child: NeuCard(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s16,
                vertical: AppTheme.s12,
              ),
              onTap: () => onSelect(f.key),
              child: Row(
                children: [
                  Icon(f.icon, color: AppTheme.accent, size: 22),
                  const SizedBox(width: AppTheme.s12),
                  Expanded(
                    child: Text(
                      f.title,
                      style: const TextStyle(
                        color: AppTheme.heading,
                        fontWeight: FontWeight.w500,
                        fontSize: 15,
                      ),
                    ),
                  ),
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: AppTheme.muted,
                    size: 22,
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _BackToMoreRow extends StatelessWidget {
  final String title;
  final VoidCallback onBack;

  const _BackToMoreRow({required this.title, required this.onBack});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.bg,
      child: InkWell(
        onTap: onBack,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppTheme.s8,
            vertical: AppTheme.s8,
          ),
          child: Row(
            children: [
              const Icon(Icons.arrow_back_rounded, color: AppTheme.heading),
              const SizedBox(width: AppTheme.s8),
              Text(
                title,
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Offline banner ──────────────────────────────────────────────────────────

/// Said once, at the top, rather than as a failure on each screen.
///
/// Nothing in this app works offline and that is deliberate — availability, the
/// price of a stay and taking a booking are all decisions about a room somebody
/// else may also be selling, and only the server can make them. So the honest
/// thing is to say the connection is gone, not to queue work that might sell a
/// room twice when it drains.
class _OfflineBanner extends ConsumerWidget {
  const _OfflineBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final online = ref.watch(networkStatusProvider);
    // Loading and error both read as "assume it works": a banner that flashes
    // on every cold start is a banner the desk stops seeing.
    final offline = online.valueOrNull == false;

    return AnimatedSize(
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
      alignment: Alignment.topCenter,
      child: !offline
          ? const SizedBox(width: double.infinity, height: 0)
          : Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(
                AppTheme.s12,
                AppTheme.s8,
                AppTheme.s12,
                0,
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s12,
                vertical: AppTheme.s8,
              ),
              decoration: BoxDecoration(
                color: AppTheme.danger.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(AppTheme.rMedium),
                border: Border.all(color: AppTheme.danger.withValues(alpha: 0.25)),
              ),
              child: Row(
                children: [
                  Container(
                    width: 24,
                    height: 24,
                    decoration: BoxDecoration(
                      color: AppTheme.danger.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.wifi_off_rounded,
                      size: 13,
                      color: AppTheme.danger,
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  const Expanded(
                    child: Text(
                      'No connection — bookings can\'t be taken right now.',
                      style: TextStyle(
                        color: AppTheme.danger,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        height: 1.2,
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

// ── Top bar ─────────────────────────────────────────────────────────────────

class _TopBar extends ConsumerWidget {
  final Me? me;

  const _TopBar({this.me});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lodgeName = me?.lodge.name ?? 'Loading…';
    final initial = lodgeName.isNotEmpty ? lodgeName[0].toUpperCase() : '?';

    final topInset = MediaQuery.of(context).padding.top;

    return Container(
      padding: EdgeInsets.fromLTRB(
        AppTheme.s12,
        AppTheme.s8 + topInset,
        AppTheme.s8,
        AppTheme.s12,
      ),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppTheme.accent, Color(0xFF434190)],
        ),
        boxShadow: [
          BoxShadow(
            color: Color(0x265A67D8),
            offset: Offset(0, 4),
            blurRadius: 10,
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.16),
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
                  ),
                  child: Text(
                    initial,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        lodgeName,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (me != null) ...[
                        const SizedBox(height: 1),
                        Text(
                          '${me!.user.name} · ${me!.user.roleName ?? me!.user.role}',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.8),
                            fontSize: 11,
                            fontWeight: FontWeight.w400,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          // Opens the profile screen, where account details and sign-out live.
          _ProfileButton(me: me),
        ],
      ),
    );
  }
}

class _ProfileButton extends StatelessWidget {
  final Me? me;

  const _ProfileButton({this.me});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Profile & settings',
      icon: const Icon(Icons.settings_outlined, color: Colors.white, size: 20),
      visualDensity: VisualDensity.compact,
      constraints: const BoxConstraints(),
      padding: const EdgeInsets.all(8),
      onPressed: me == null
          ? null
          : () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ProfileScreen()),
              ),
    );
  }
}

// ── Bottom bar tab ──────────────────────────────────────────────────────────

class _Tab extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _Tab({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    // The selected tab is pressed into the surface rather than tinted. That is
    // the whole grammar of this design system: a thing you have chosen sits
    // below the surface, a thing you can choose sits above it.
    final content = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          icon,
          size: 20,
          color: selected ? AppTheme.accent : AppTheme.muted,
        ),
        const SizedBox(height: 4),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 11,
            fontWeight: selected ? FontWeight.w500 : FontWeight.w400,
            color: selected ? AppTheme.accent : AppTheme.muted,
          ),
        ),
      ],
    );

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        // 44px minimum for a thumb.
        constraints: const BoxConstraints(minHeight: 44),
        margin: const EdgeInsets.symmetric(horizontal: 3),
        alignment: Alignment.center,
        child: selected
            ? NeuPressed(
                radius: AppTheme.rMedium,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTheme.s8,
                  vertical: 4,
                ),
                child: content,
              )
            : Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTheme.s8,
                  vertical: 4,
                ),
                child: content,
              ),
      ),
    );
  }
}
