import 'package:flutter/material.dart';

import '../../domain/models/me.dart';
import '../theme.dart';
import 'feature.dart';

/// The section list the web dashboard puts in its left rail — same tokens
/// (OwnerDashboard.css / index.css: --brand-wash, --brand-ink, --text-muted,
/// --radius-tile…), same grouping, same collapsible headers, so the rail
/// reads as one surface across both clients rather than a phone-flavoured
/// guess at it.
///
/// Used two ways from [DashboardShell]: as the permanent rail on a screen
/// wide enough to hold one (mirroring the web, where the rail never hides),
/// and inside a [Drawer] on a phone, opened from the top bar's hamburger —
/// there is no room to keep 240px of nav on screen at all times there.
class Sidebar extends StatelessWidget {
  final List<Feature> features;
  final String? activeKey;
  final ValueChanged<String> onSelect;

  /// Per-group open/closed overrides. A group not present here falls back to
  /// "open iff it holds the active section" — the same default the web
  /// sidebar's `groupOpen` uses.
  final Map<String, bool> groupToggle;
  final ValueChanged<String> onToggleGroup;

  /// Who is signed in and what property this is — the property's name and
  /// the signed-in user's name/role both show in the header above the nav.
  /// Null while `/me` is still loading.
  final Me? me;

  /// Opens the profile/settings screen — the nav list's own standalone
  /// Settings row, sitting below every group rather than pinned in the
  /// footer, since Settings is still "go look at a screen" the same way a
  /// section is, just one every login has regardless of permission.
  final VoidCallback onProfileTap;

  /// Signs out — the rail's own pinned footer, the one action here that
  /// isn't a screen to visit.
  final VoidCallback onLogoutTap;

  /// Icon-only mode — the rail shrunk to just its icons, same collapse
  /// affordance VS Code/Notion/Linear give their own left rail so it costs
  /// less width once the desk knows the icons. Always false for the phone
  /// drawer, which has nothing to gain from shrinking further.
  final bool collapsed;

  /// Toggles [collapsed]. Null hides the control entirely — the drawer
  /// passes null since collapsing an already-dismissible overlay has no use.
  final VoidCallback? onToggleCollapsed;

  const Sidebar({
    super.key,
    required this.features,
    required this.activeKey,
    required this.onSelect,
    required this.groupToggle,
    required this.onToggleGroup,
    required this.me,
    required this.onProfileTap,
    required this.onLogoutTap,
    this.collapsed = false,
    this.onToggleCollapsed,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppTheme.card,
      child: Column(
        children: [
          _SidebarHeader(
            me: me,
            collapsed: collapsed,
            onToggleCollapsed: onToggleCollapsed,
          ),
          Expanded(
            child: _SidebarNav(
              features: features,
              activeKey: activeKey,
              onSelect: onSelect,
              groupToggle: groupToggle,
              onToggleGroup: onToggleGroup,
              collapsed: collapsed,
              onProfileTap: onProfileTap,
            ),
          ),
          _SidebarFooter(
            me: me,
            onLogoutTap: onLogoutTap,
            collapsed: collapsed,
          ),
        ],
      ),
    );
  }
}

/// The scrollable nav list — its own [State] so it can find and jump to the
/// active row itself, rather than leaving the desk to hunt for it.
///
/// Every open of the phone drawer mounts a brand new one of these, always
/// scrolled back to the top — so with a login that reaches every group
/// (four of them, the last one, Finance & Management, sitting well past one
/// screen's height) whatever was picked last is invisible until the desk
/// scrolls down blind to find it, mis-tapping rows along the way. The same
/// thing happens on the permanent rail after switching into a section
/// nested deep in a later group. [_scrollToActive] runs after the first
/// frame (and again whenever [activeKey] changes) and brings that row into
/// view on its own.
class _SidebarNav extends StatefulWidget {
  final List<Feature> features;
  final String? activeKey;
  final ValueChanged<String> onSelect;
  final Map<String, bool> groupToggle;
  final ValueChanged<String> onToggleGroup;
  final bool collapsed;

  /// Opens the profile/settings screen — rendered as its own standalone row
  /// right below the last group, always visible and never collapsed with
  /// it, since Settings belongs to every login rather than to whichever
  /// permission gates the group above it.
  final VoidCallback onProfileTap;

  const _SidebarNav({
    required this.features,
    required this.activeKey,
    required this.onSelect,
    required this.groupToggle,
    required this.onToggleGroup,
    required this.collapsed,
    required this.onProfileTap,
  });

  /// Same order as the web's own SIDEBAR_GROUP_ORDER.
  static const groupOrder = [
    'Rooms',
    'Restaurant',
    'Events',
    'Finance & Management',
    'Reports & Analytics',
    'Setup',
  ];

  @override
  State<_SidebarNav> createState() => _SidebarNavState();
}

class _SidebarNavState extends State<_SidebarNav> {
  /// One [GlobalKey] per feature, created lazily and kept for the life of
  /// this State — [_scrollToActive] looks a row's key up to find its
  /// on-screen [BuildContext] and ask the [Scrollable] to reveal it.
  final Map<String, GlobalKey> _itemKeys = {};

  GlobalKey _keyFor(String featureKey) =>
      _itemKeys.putIfAbsent(featureKey, GlobalKey.new);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToActive());
  }

  @override
  void didUpdateWidget(covariant _SidebarNav oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.activeKey != widget.activeKey) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToActive());
    }
  }

  void _scrollToActive() {
    final key = widget.activeKey;
    if (key == null || !mounted) return;
    final activeContext = _itemKeys[key]?.currentContext;
    if (activeContext == null) return;
    Scrollable.ensureVisible(
      activeContext,
      alignment: 0.5,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  bool _groupOpen(String group, String? activeGroup) =>
      widget.groupToggle[group] ?? (group == activeGroup);

  Widget _item(Feature f) => KeyedSubtree(
    key: _keyFor(f.key),
    child: _SidebarItem(
      feature: f,
      selected: f.key == widget.activeKey,
      collapsed: widget.collapsed,
      onTap: () => widget.onSelect(f.key),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final features = widget.features;
    final collapsed = widget.collapsed;

    String? activeGroup;
    for (final f in features) {
      if (f.key == widget.activeKey) {
        activeGroup = f.group;
        break;
      }
    }

    final ungrouped = features.where((f) => f.group == null).toList();
    final groups = [
      for (final g in _SidebarNav.groupOrder)
        if (features.any((f) => f.group == g)) g,
    ];

    return ListView(
      padding: EdgeInsets.symmetric(
        vertical: AppTheme.s16 + 2,
        horizontal: collapsed ? AppTheme.s8 : AppTheme.s12 + 2,
      ),
      children: [
        if (ungrouped.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: AppTheme.s16 + 6),
            child: Column(
              children: [for (final f in ungrouped) _item(f)],
            ),
          ),
        for (int i = 0; i < groups.length; i++)
          Padding(
            padding: EdgeInsets.only(
              bottom: i == groups.length - 1 ? 0 : AppTheme.s16 + 6,
            ),
            child: Column(
              children: [
                // Collapsed mode has no room for a group label, so rows sit
                // flat with a hairline divider between clusters instead —
                // the grouping still reads, just without the text that
                // would otherwise wrap or clip at 72px.
                if (collapsed) ...[
                  if (i > 0)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: AppTheme.s8),
                      child: Divider(
                        height: 1,
                        thickness: 1,
                        color: AppTheme.sidebarBorder,
                      ),
                    ),
                  for (final f in features.where((f) => f.group == groups[i]))
                    _item(f),
                ] else ...[
                  _GroupHeader(
                    title: groups[i],
                    expanded: _groupOpen(groups[i], activeGroup),
                    onTap: () => widget.onToggleGroup(groups[i]),
                  ),
                  if (_groupOpen(groups[i], activeGroup))
                    for (final f in features.where(
                      (f) => f.group == groups[i],
                    ))
                      _item(f),
                ],
              ],
            ),
          ),
        // Below every group, its own row rather than folded into any of
        // them — Settings isn't gated by a permission the way the groups
        // above it are, so it never collapses with one and never needs its
        // own header.
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
          child: const Divider(height: 1, thickness: 1, color: AppTheme.sidebarBorder),
        ),
        _SettingsNavRow(collapsed: collapsed, onTap: widget.onProfileTap),
      ],
    );
  }
}

/// The rail's own header: the property's name on top and, directly below
/// it, who is signed into it — the same "which workspace, which account"
/// pairing Slack/Notion put at the head of their own rail, now anchored here
/// instead of floating in a gradient top bar. Also carries the collapse
/// toggle, so shrinking the rail is reachable from the same place its
/// identity lives.
class _SidebarHeader extends StatelessWidget {
  final Me? me;
  final bool collapsed;
  final VoidCallback? onToggleCollapsed;

  const _SidebarHeader({
    required this.me,
    required this.collapsed,
    required this.onToggleCollapsed,
  });

  @override
  Widget build(BuildContext context) {
    final lodgeName = me?.lodge.name ?? 'Loading…';
    final initial = lodgeName.isNotEmpty ? lodgeName[0].toUpperCase() : '?';
    final user = me?.user;

    final badge = Container(
      width: 34,
      height: 34,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppTheme.sidebarBrand, AppTheme.sidebarBrandInk],
        ),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        boxShadow: [
          BoxShadow(
            color: AppTheme.sidebarBrand.withValues(alpha: 0.28),
            offset: const Offset(0, 2),
            blurRadius: 6,
          ),
        ],
      ),
      child: Text(
        initial,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 15,
          fontWeight: FontWeight.w700,
        ),
      ),
    );

    if (collapsed) {
      return Container(
        padding: const EdgeInsets.symmetric(
          vertical: AppTheme.s16,
          horizontal: AppTheme.s8,
        ),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: AppTheme.sidebarBorder)),
        ),
        child: Column(
          children: [
            Tooltip(message: lodgeName, child: badge),
            if (onToggleCollapsed != null) ...[
              const SizedBox(height: AppTheme.s12),
              _RailToggle(collapsed: true, onTap: onToggleCollapsed!),
            ],
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s16,
        AppTheme.s16,
        AppTheme.s12,
        AppTheme.s12,
      ),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppTheme.sidebarBorder)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              badge,
              const SizedBox(width: AppTheme.s12 - 2),
              Expanded(
                child: Text(
                  lodgeName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.heading,
                  ),
                ),
              ),
              if (onToggleCollapsed != null)
                _RailToggle(collapsed: false, onTap: onToggleCollapsed!),
            ],
          ),
          // Who is logged in, right below the property name — its own line
          // rather than folded into the row above, so both read clearly at
          // a glance instead of competing for one line's width.
          if (user != null) ...[
            const SizedBox(height: AppTheme.s8 + 2),
            Padding(
              padding: const EdgeInsets.only(left: 34 + AppTheme.s12 - 2),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      user.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.sidebarText,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.s8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: AppTheme.sidebarBrandWash,
                      borderRadius: BorderRadius.circular(AppTheme.rSmall),
                    ),
                    child: Text(
                      user.roleName ?? user.role,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.sidebarBrandInk,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The small square button that shrinks/restores the rail — a chevron pair
/// rather than a hamburger, so it reads as "collapse this panel" rather than
/// "open a menu" (the phone drawer already owns that icon in the top bar).
class _RailToggle extends StatelessWidget {
  final bool collapsed;
  final VoidCallback onTap;

  const _RailToggle({required this.collapsed, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(AppTheme.rSmall),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        hoverColor: AppTheme.bg,
        onTap: onTap,
        child: Tooltip(
          message: collapsed ? 'Expand sidebar' : 'Collapse sidebar',
          child: Padding(
            padding: const EdgeInsets.all(AppTheme.s4),
            child: Icon(
              collapsed
                  ? Icons.keyboard_double_arrow_right_rounded
                  : Icons.keyboard_double_arrow_left_rounded,
              size: 18,
              color: AppTheme.sidebarTextMuted,
            ),
          ),
        ),
      ),
    );
  }
}

/// Pinned to the very bottom of the rail regardless of how the nav above
/// scrolls — Sign out, and nothing else. Settings lives just above the nav
/// list's own [_SettingsNavRow] instead: this footer is the one action left
/// that isn't "go look at a screen", so it stays on its own down here.
class _SidebarFooter extends StatelessWidget {
  final Me? me;
  final VoidCallback onLogoutTap;
  final bool collapsed;

  const _SidebarFooter({
    required this.me,
    required this.onLogoutTap,
    required this.collapsed,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = me != null;
    const icon = Icon(Icons.logout_rounded, size: 18, color: AppTheme.danger);

    final content = collapsed
        ? const Padding(
            padding: EdgeInsets.symmetric(vertical: AppTheme.s12 - 2),
            child: Center(child: icon),
          )
        : const Padding(
            padding: EdgeInsets.symmetric(
              horizontal: AppTheme.s12 - 2,
              vertical: AppTheme.s12 - 2,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                icon,
                SizedBox(width: AppTheme.s12 - 2),
                Text(
                  'Sign out',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.danger,
                  ),
                ),
              ],
            ),
          );

    return Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppTheme.sidebarBorder)),
      ),
      padding: const EdgeInsets.all(AppTheme.s8 + 2),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.rMedium),
          hoverColor: AppTheme.danger.withValues(alpha: 0.08),
          onTap: enabled ? onLogoutTap : null,
          child: collapsed ? Tooltip(message: 'Sign out', child: content) : content,
        ),
      ),
    );
  }
}

class _SidebarItem extends StatelessWidget {
  final Feature feature;
  final bool selected;
  final bool collapsed;
  final VoidCallback onTap;

  const _SidebarItem({
    required this.feature,
    required this.selected,
    required this.collapsed,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final icon = Icon(
      feature.icon,
      size: collapsed ? 20 : 18,
      color: selected ? AppTheme.sidebarBrandInk : AppTheme.sidebarTextMuted,
    );

    final row = collapsed
        ? SizedBox(height: 40, child: Center(child: icon))
        : Row(
            children: [
              // The web's own short left-edge bar on the selected row — a
              // 3×18 rounded pill rather than a full-height border, so it
              // reads as a marker rather than a second, thinner card
              // outline sitting inside the first.
              SizedBox(
                width: 3,
                height: 18,
                child: selected
                    ? DecoratedBox(
                        decoration: BoxDecoration(
                          color: AppTheme.sidebarBrand,
                          borderRadius: const BorderRadius.horizontal(
                            right: Radius.circular(3),
                          ),
                        ),
                      )
                    : null,
              ),
              const SizedBox(width: AppTheme.s8),
              icon,
              const SizedBox(width: AppTheme.s12 - 2),
              Expanded(
                child: Text(
                  feature.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                    color: selected ? AppTheme.sidebarBrandInk : AppTheme.sidebarText,
                  ),
                ),
              ),
            ],
          );

    final button = Material(
      color: selected ? AppTheme.sidebarBrandWash : Colors.transparent,
      borderRadius: BorderRadius.circular(AppTheme.rLarge - 6),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.rLarge - 6),
        hoverColor: selected
            ? AppTheme.sidebarBrandWash
            : AppTheme.bg,
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.rLarge - 6),
            border: selected
                ? Border.all(color: AppTheme.sidebarBrandWashEdge)
                : Border.all(color: Colors.transparent),
          ),
          padding: collapsed
              ? EdgeInsets.zero
              : const EdgeInsets.symmetric(
                  horizontal: AppTheme.s12,
                  vertical: AppTheme.s8 + 1,
                ),
          child: row,
        ),
      ),
    );

    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: collapsed ? Tooltip(message: feature.title, child: button) : button,
    );
  }
}

/// The nav list's own last row — Settings, opening the profile screen.
/// Styled the same as [_GroupHeader] above it (same uppercase label, same
/// type) so it reads as one more section of the rail rather than a
/// leftover item tacked on below the real groups — the one difference is
/// the trailing icon: a plain chevron rather than the rotating one, since
/// tapping this pushes a new screen instead of expanding rows in place.
class _SettingsNavRow extends StatelessWidget {
  final bool collapsed;
  final VoidCallback onTap;

  const _SettingsNavRow({required this.collapsed, required this.onTap});

  @override
  Widget build(BuildContext context) {
    if (collapsed) {
      final button = Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppTheme.rLarge - 6),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.rLarge - 6),
          hoverColor: AppTheme.bg,
          onTap: onTap,
          child: const SizedBox(
            height: 40,
            child: Center(
              child: Icon(Icons.settings_outlined, size: 20, color: AppTheme.sidebarTextMuted),
            ),
          ),
        ),
      );
      return Tooltip(message: 'Settings', child: button);
    }

    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(AppTheme.rSmall),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        hoverColor: AppTheme.bg,
        onTap: onTap,
        child: const Padding(
          padding: EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, AppTheme.s8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'SETTINGS',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.sidebarText,
                    letterSpacing: 0.9,
                  ),
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                size: 16,
                color: AppTheme.sidebarTextMuted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A group's own header row — its name and a chevron that flips to say
/// whether the rows under it are showing, same grammar as the web sidebar's
/// dropdown groups.
class _GroupHeader extends StatelessWidget {
  final String title;
  final bool expanded;
  final VoidCallback onTap;

  const _GroupHeader({
    required this.title,
    required this.expanded,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(AppTheme.rSmall),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        hoverColor: AppTheme.bg,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s12,
            AppTheme.s4,
            AppTheme.s12,
            AppTheme.s8,
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  title.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.sidebarText,
                    letterSpacing: 0.9,
                  ),
                ),
              ),
              AnimatedRotation(
                duration: const Duration(milliseconds: 150),
                turns: expanded ? 0.5 : 0,
                child: const Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 16,
                  color: AppTheme.sidebarTextMuted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
