import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/me.dart';
import '../../presentation/providers/network_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../assets/assets_screen.dart';
import '../billing/billing_screen.dart';
import '../billing/event_billing_screen.dart';
import '../bookings/bookings_screen.dart';
import '../bookings/register_screen.dart';
import '../events/events_screen.dart';
import '../expenses/expenses_screen.dart';
import '../food/food_billing_screen.dart';
import '../food/menu_setup_screen.dart';
import '../income/income_screen.dart';
import '../placeholder_screen.dart';
import '../profile/profile_screen.dart';
import '../reports/reports_screen.dart';
import '../rooms/rooms_rates_screen.dart';
import '../staff/staff_roles_screen.dart';
import '../theme.dart';
import 'feature.dart';
import 'sidebar.dart';

/// The signed-in app: a top bar, a section, and the sidebar that chooses it —
/// the same rail the web dashboard uses, rather than a phone bottom bar.
///
/// A permanent rail on a screen wide enough to hold one; on a phone it slides
/// in from the top bar's hamburger instead, the same way the web's own rail
/// collapses below its breakpoint.
class DashboardShell extends ConsumerStatefulWidget {
  const DashboardShell({super.key});

  @override
  ConsumerState<DashboardShell> createState() => _DashboardShellState();
}

class _DashboardShellState extends ConsumerState<DashboardShell> {
  String? _section;

  /// Per-group open/closed overrides — see [Sidebar].
  final Map<String, bool> _groupToggle = {};

  /// Icon-only rail — only meaningful for the permanent rail; the phone
  /// drawer never collapses (see [Sidebar.onToggleCollapsed]).
  bool _railCollapsed = false;

  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  /// Set on the first "back" press while already on the home section —
  /// a second press within [_exitWindow] actually exits the app.
  DateTime? _lastBackPressedAt;
  static const _exitWindow = Duration(seconds: 2);

  @override
  void initState() {
    super.initState();
    // Never synchronously in initState — the provider is not ready to be
    // written to during the first build.
    Future.microtask(() => ref.read(authViewModelProvider.notifier).loadMe());
  }

  void _toggleGroup(String group, String? activeGroup) {
    final open = _groupToggle[group] ?? (group == activeGroup);
    setState(() => _groupToggle[group] = !open);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authViewModelProvider);
    final me = state.me;
    final compact = AppTheme.isCompact(context);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: AppTheme.card,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
      ),
      child: PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, result) {
          if (didPop) return;
          _handleBack(me);
        },
        child: Scaffold(
          key: _scaffoldKey,
          drawer: (me != null && compact) ? _drawer(me) : null,
          body: Column(
            children: [
              _TopBar(
                title: me == null ? null : _activeTitle(_features(me)),
                onMenuTap: (me != null && compact)
                    ? () => _scaffoldKey.currentState?.openDrawer()
                    : null,
              ),
              const _OfflineBanner(),
              Expanded(
                child: SafeArea(
                  top: false,
                  bottom: false,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (me != null && !compact) _rail(me),
                      Expanded(
                        child: _ResponsiveBody(
                          child: _body(state.isLoading, state.error, me),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Back always lands on the home section first instead of exiting
  /// straight from whatever section the desk happened to be on — same
  /// pattern as WhatsApp/Instagram's bottom-tab back behavior. Only a
  /// second back press within [_exitWindow], while already on the home
  /// section, actually exits the app.
  void _handleBack(Me? me) {
    if (me != null) {
      final features = _features(me);
      if (features.isNotEmpty) {
        final homeKey = features.first.key;
        if (_activeKey(features) != homeKey) {
          _select(homeKey);
          return;
        }
      }
    }

    final now = DateTime.now();
    if (_lastBackPressedAt != null &&
        now.difference(_lastBackPressedAt!) < _exitWindow) {
      SystemNavigator.pop();
      return;
    }
    _lastBackPressedAt = now;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Press back again to exit'),
        duration: Duration(seconds: 2),
      ),
    );
  }

  List<Feature> _features(Me me) =>
      kFeatures.where((f) => f.availableTo(me)).toList();

  /// `_section` stays null until the desk actually taps something — it is
  /// never written on load, only read. Everywhere that needs "the section
  /// actually showing" (the sidebar's own highlight, which group starts
  /// open, the body) has to fall back to the same first feature the body
  /// lands on, or the sidebar and the body would agree on different
  /// sections whenever nothing has been tapped yet.
  String _activeKey(List<Feature> features) {
    final section = _section;
    if (section != null && features.any((f) => f.key == section)) {
      return section;
    }
    return features.first.key;
  }

  /// The active section's title — what the top bar shows now that the
  /// lodge/role identity it used to carry lives in the sidebar instead.
  String _activeTitle(List<Feature> features) {
    final key = _activeKey(features);
    for (final f in features) {
      if (f.key == key) return f.title;
    }
    return '';
  }

  String? _activeGroup(List<Feature> features) {
    final key = _activeKey(features);
    for (final f in features) {
      if (f.key == key) return f.group;
    }
    return null;
  }

  void _select(String key) => setState(() => _section = key);

  /// Same confirmation ProfileScreen's own sign-out carries. No popUntil
  /// needed here the way that screen needs one: DashboardShell is the root
  /// AuthGate swaps out on sign-out, not a route pushed on top of it, so
  /// clearing the session is enough for AuthGate to show LoginScreen next
  /// build.
  Future<void> _confirmSignOut(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Sign out?', style: TextStyle(color: AppTheme.heading)),
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
            child: const Text('Sign out', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (ok == true) {
      await ref.read(authViewModelProvider.notifier).signOut();
    }
  }

  Widget _rail(Me me) {
    final features = _features(me);
    if (features.isEmpty) return const SizedBox.shrink();
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOutCubic,
      width: _railCollapsed ? 72 : 240,
      decoration: const BoxDecoration(
        border: Border(right: BorderSide(color: AppTheme.sidebarBorder)),
      ),
      child: Sidebar(
        features: features,
        activeKey: _activeKey(features),
        onSelect: _select,
        groupToggle: _groupToggle,
        onToggleGroup: (g) => _toggleGroup(g, _activeGroup(features)),
        me: me,
        onProfileTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const ProfileScreen()),
        ),
        onLogoutTap: () => _confirmSignOut(context),
        collapsed: _railCollapsed,
        onToggleCollapsed: () =>
            setState(() => _railCollapsed = !_railCollapsed),
      ),
    );
  }

  Widget _drawer(Me me) {
    final features = _features(me);
    return Drawer(
      width: 280,
      child: SafeArea(
        child: Sidebar(
          features: features,
          activeKey: features.isEmpty ? null : _activeKey(features),
          onSelect: (key) {
            Navigator.of(context).pop();
            _select(key);
          },
          groupToggle: _groupToggle,
          onToggleGroup: (g) => _toggleGroup(g, _activeGroup(features)),
          me: me,
          onProfileTap: () {
            Navigator.of(context).pop();
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ProfileScreen()),
            );
          },
          onLogoutTap: () {
            Navigator.of(context).pop();
            _confirmSignOut(context);
          },
        ),
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

    final features = _features(me);
    if (features.isEmpty) {
      return const NeuNotice(
        message: 'This login cannot reach any section yet.\n'
            'Ask the owner to grant it a role.',
        icon: Icons.lock_outline_rounded,
      );
    }

    final active = features.firstWhere(
      (f) => f.key == _activeKey(features),
      orElse: () => features.first,
    );

    switch (active.key) {
      case 'bookings':
        return const BookingsScreen();
      case 'register':
        return const RegisterScreen();
      case 'food':
        return const FoodBillingScreen();
      case 'billing':
        return const BillingScreen();
      case 'eventBilling':
        return const EventBillingScreen();
      case 'rooms':
        return const RoomsRatesScreen();
      case 'menu':
        return const MenuSetupScreen();
      // The three keyed separately (not just a different initialTab on the
      // same widget) so switching between them actually resets which of
      // EventsScreen's own tabs is showing — same-type widgets otherwise
      // keep their old State across a rebuild instead of re-reading
      // initialTab.
      case 'events':
        return const EventsScreen(key: ValueKey('events'), initialTab: 'diary');
      case 'eventRegister':
        return const EventsScreen(key: ValueKey('eventRegister'), initialTab: 'list');
      case 'eventSetup':
        return const EventsScreen(key: ValueKey('eventSetup'), initialTab: 'setup');
      case 'assets':
        return const AssetsScreen();
      case 'expenses':
        return const ExpensesScreen();
      case 'income':
        return const IncomeScreen();
      case 'report-overview':
        return const ReportsScreen(key: ValueKey('report-overview'), only: 'overview');
      case 'report-sales':
        return const ReportsScreen(key: ValueKey('report-sales'), only: 'sales');
      case 'report-finance':
        return const ReportsScreen(key: ValueKey('report-finance'), only: 'finance');
      case 'report-assets':
        return const ReportsScreen(key: ValueKey('report-assets'), only: 'assets');
      case 'staff':
        return const StaffRolesScreen();
      default:
        // Every other section is deliberately still a stub — see the file.
        return PlaceholderScreen(feature: active);
    }
  }
}

/// Caps a section's width and centers it once the surface is wider than a
/// phone — a tablet or the desktop/web build — instead of stretching every
/// list and form full-bleed the way a phone screen naturally does.
class _ResponsiveBody extends StatelessWidget {
  final Widget child;

  const _ResponsiveBody({required this.child});

  @override
  Widget build(BuildContext context) {
    if (AppTheme.isCompact(context)) return child;
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
        child: child,
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

/// A plain, flat bar — just the section title and, on a phone, the button
/// that opens the drawer. The lodge's identity and the signed-in user no
/// longer live here: they sit in the sidebar's own header and footer
/// instead, the same split professional dashboards (Linear, Notion, Vercel)
/// make between "which workspace" (rail) and "which page" (top bar).
class _TopBar extends StatelessWidget {
  final String? title;

  /// Present only on a compact width, where the rail lives behind a drawer —
  /// null hides the button rather than leaving it disabled, since a screen
  /// wide enough for the permanent rail has nothing for it to open.
  final VoidCallback? onMenuTap;

  const _TopBar({this.title, this.onMenuTap});

  @override
  Widget build(BuildContext context) {
    final topInset = MediaQuery.of(context).padding.top;

    return Container(
      padding: EdgeInsets.fromLTRB(
        AppTheme.s8,
        topInset,
        AppTheme.s16,
        0,
      ),
      decoration: const BoxDecoration(
        color: AppTheme.card,
        border: Border(bottom: BorderSide(color: AppTheme.border)),
      ),
      child: SizedBox(
        height: 52,
        child: Row(
          children: [
            if (onMenuTap != null)
              IconButton(
                tooltip: 'Sections',
                icon: const Icon(Icons.menu_rounded, color: AppTheme.text, size: 22),
                visualDensity: VisualDensity.compact,
                onPressed: onMenuTap,
              )
            else
              const SizedBox(width: AppTheme.s8),
            Expanded(
              child: Text(
                title ?? '',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
