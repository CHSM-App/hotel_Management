import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/me.dart';
import '../../presentation/providers/network_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../billing/billing_screen.dart';
import '../bookings/bookings_screen.dart';
import '../food/orders_screen.dart';
import '../placeholder_screen.dart';
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

class _DashboardShellState extends ConsumerState<DashboardShell> {
  String? _section;

  @override
  void initState() {
    super.initState();
    // Never synchronously in initState — the provider is not ready to be
    // written to during the first build.
    Future.microtask(() => ref.read(authViewModelProvider.notifier).loadMe());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authViewModelProvider);
    final me = state.me;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _TopBar(me: me),
            const _OfflineBanner(),
            Expanded(child: _body(state.isLoading, state.error, me)),
          ],
        ),
      ),
      bottomNavigationBar: me == null ? null : _bottomBar(me),
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

    final active = features.firstWhere(
      (f) => f.key == _section,
      orElse: () => features.first,
    );

    switch (active.key) {
      case 'bookings':
        return const BookingsScreen();
      case 'food':
        return const OrdersScreen();
      case 'billing':
        return const BillingScreen();
      case 'rooms':
        return const RoomsRatesScreen();
      default:
        // Every other section is deliberately still a stub — see the file.
        return PlaceholderScreen(feature: active);
    }
  }

  Widget _bottomBar(Me me) {
    final features = kFeatures.where((f) => f.availableTo(me)).toList();
    if (features.isEmpty) return const SizedBox.shrink();

    final primary = features.take(kPrimaryTabs).toList();
    final overflow = features.skip(kPrimaryTabs).toList();

    final active = features.firstWhere(
      (f) => f.key == _section,
      orElse: () => features.first,
    );
    final activeIsOverflow = overflow.any((f) => f.key == active.key);

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
            vertical: AppTheme.s8,
          ),
          // The row is held to the height of a tab and no more.
          //
          // Without this it grew to fill the whole screen: the bottom bar slot
          // is given loose constraints, a Row's cross-axis default is stretch,
          // and _Tab is a Container with a minHeight and no maximum — so every
          // tab happily took 600px, the bar took the lot, and the body was left
          // with nothing. Which is why the app looked like a navbar floating in
          // the middle of an empty page rather than like an error.
          child: SizedBox(
            height: 60,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final f in primary)
                  Expanded(
                    child: _Tab(
                      icon: f.icon,
                      label: f.tabLabel,
                      selected: !activeIsOverflow && f.key == active.key,
                      onTap: () => setState(() => _section = f.key),
                    ),
                  ),
                if (overflow.isNotEmpty)
                  Expanded(
                    child: _Tab(
                      icon: Icons.more_horiz_rounded,
                      label: 'More',
                      selected: activeIsOverflow,
                      onTap: () => _openMore(overflow),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _openMore(List<Feature> overflow) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppTheme.bg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppTheme.rLarge),
        ),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: AppTheme.s12),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.shadowDark,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: AppTheme.s16),
            for (final f in overflow)
              ListTile(
                leading: Icon(f.icon, color: AppTheme.text),
                title: Text(
                  f.title,
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                onTap: () => Navigator.pop(context, f.key),
              ),
            const SizedBox(height: AppTheme.s8),
          ],
        ),
      ),
    );
    if (picked != null) setState(() => _section = picked);
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
    if (online.valueOrNull != false) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      color: AppTheme.danger.withValues(alpha: 0.1),
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s16,
        vertical: AppTheme.s8,
      ),
      child: const Row(
        children: [
          Icon(Icons.wifi_off_rounded, size: 16, color: AppTheme.danger),
          SizedBox(width: AppTheme.s8),
          Expanded(
            child: Text(
              'No connection — bookings cannot be taken until this is back.',
              style: TextStyle(color: AppTheme.danger, fontSize: 12),
            ),
          ),
        ],
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s16,
        AppTheme.s12,
        AppTheme.s16,
        AppTheme.s8,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  me?.lodge.name ?? 'Loading…',
                  style: Theme.of(context).textTheme.titleMedium,
                  overflow: TextOverflow.ellipsis,
                ),
                if (me != null)
                  Text(
                    '${me!.user.name} · ${me!.user.roleName ?? me!.user.role}',
                    style: Theme.of(context).textTheme.bodySmall,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
          // Present whether or not /me loaded.
          //
          // On the web dashboard this control lived inside the profile menu,
          // which is built from /me — so when that call failed there was no
          // menu, and signing out was the one thing a stranded desk could not
          // do. It is not going to be reachable only on the happy path here.
          _SignOutButton(),
        ],
      ),
    );
  }
}

class _SignOutButton extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return IconButton(
      tooltip: 'Sign out',
      icon: const Icon(Icons.logout_rounded, color: AppTheme.text),
      onPressed: () async {
        final ok = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            backgroundColor: AppTheme.bg,
            title: const Text(
              'Sign out?',
              style: TextStyle(color: AppTheme.heading),
            ),
            content: const Text(
              'You will need your phone or email and password to get back in.',
              style: TextStyle(color: AppTheme.text),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Stay signed in'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text(
                  'Sign out',
                  style: TextStyle(color: AppTheme.danger),
                ),
              ),
            ],
          ),
        );
        if (ok == true) {
          await ref.read(authViewModelProvider.notifier).signOut();
        }
      },
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
        constraints: const BoxConstraints(minHeight: 52),
        margin: const EdgeInsets.symmetric(horizontal: 3),
        alignment: Alignment.center,
        child: selected
            ? NeuPressed(
                radius: AppTheme.rMedium,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTheme.s8,
                  vertical: AppTheme.s8,
                ),
                child: content,
              )
            : Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppTheme.s8,
                  vertical: AppTheme.s8,
                ),
                child: content,
              ),
      ),
    );
  }
}
