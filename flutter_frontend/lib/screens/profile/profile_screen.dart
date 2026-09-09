import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/constant.dart';
import '../../domain/models/me.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// The account screen — who is signed in, what property they're on, and the
/// one action that matters here: signing out. Everything shown already lives
/// in the `/me` payload the shell loaded, so this screen reads it rather than
/// firing a fetch of its own.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(authViewModelProvider).me;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      body: me == null
          ? const Center(child: CircularProgressIndicator())
          : Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 560),
                child: CustomScrollView(
              slivers: [
                SliverToBoxAdapter(child: _Header(me: me)),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    AppTheme.s16,
                    AppTheme.s24,
                    AppTheme.s16,
                    AppTheme.s32,
                  ),
                  sliver: SliverList(
                    delegate: SliverChildListDelegate([
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const _SectionLabel('Contact', icon: Icons.person_outline_rounded),
                          if (_hasText(me.user.phone))
                            _LinkButton(
                              icon: Icons.call_rounded,
                              label: 'Get in touch',
                              onTap: () => launchUrl(Uri.parse('tel:${me.user.phone}')),
                            ),
                        ],
                      ),
                      const SizedBox(height: AppTheme.s12),
                      NeuCard(
                        padding: EdgeInsets.zero,
                        child: Column(
                          children: [
                            _InfoRow(
                              icon: Icons.badge_rounded,
                              iconColor: AppTheme.accent,
                              label: 'Role',
                              value: me.user.roleName ?? me.user.role,
                            ),
                            const _RowDivider(),
                            _ActionRow(
                              icon: Icons.email_rounded,
                              iconColor: const Color(0xFFE0457C),
                              label: 'Email',
                              subtitle: me.user.email ?? '—',
                              onTap: _hasText(me.user.email)
                                  ? () => launchUrl(Uri.parse('mailto:${me.user.email}'))
                                  : null,
                            ),
                            const _RowDivider(),
                            _ActionRow(
                              icon: Icons.call_rounded,
                              iconColor: AppTheme.vacant,
                              label: 'Phone',
                              subtitle: me.user.phone ?? '—',
                              onTap: _hasText(me.user.phone)
                                  ? () => launchUrl(Uri.parse('tel:${me.user.phone}'))
                                  : null,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppTheme.s24),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const _SectionLabel('Property', icon: Icons.storefront_outlined),
                          // Mirrors the web dashboard's "Hotel profile" edit,
                          // which is owner-only there too.
                          if (me.user.role == 'OWNER')
                            GestureDetector(
                              onTap: () => _openEditLodge(context, ref, me.lodge),
                              child: const Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.edit_outlined, size: 14, color: AppTheme.accent),
                                  SizedBox(width: 4),
                                  Text(
                                    'Edit',
                                    style: TextStyle(
                                      color: AppTheme.accent,
                                      fontSize: 12.5,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: AppTheme.s12),
                      NeuCard(
                        padding: EdgeInsets.zero,
                        child: Column(
                          children: [
                            _InfoRow(
                              icon: Icons.storefront_rounded,
                              iconColor: AppTheme.accent,
                              label: 'Lodge',
                              value: me.lodge.name,
                            ),
                            const _RowDivider(),
                            _InfoRow(
                              icon: Icons.location_on_rounded,
                              iconColor: const Color(0xFF2F7FE4),
                              label: 'Address',
                              value: _address(me.lodge),
                            ),
                            if (_hasText(me.lodge.nameMr)) ...[
                              const _RowDivider(),
                              _InfoRow(
                                icon: Icons.translate_rounded,
                                iconColor: const Color(0xFF2F7FE4),
                                label: 'Name (Marathi)',
                                value: me.lodge.nameMr!,
                              ),
                            ],
                            if (_hasText(me.lodge.addressMr)) ...[
                              const _RowDivider(),
                              _InfoRow(
                                icon: Icons.translate_rounded,
                                iconColor: const Color(0xFF2F7FE4),
                                label: 'Address (Marathi)',
                                value: me.lodge.addressMr!,
                              ),
                            ],
                            if (_hasText(me.lodge.checkinMode)) ...[
                              const _RowDivider(),
                              _InfoRow(
                                icon: Icons.schedule_rounded,
                                iconColor: AppTheme.draft,
                                label: 'Check-in',
                                value: _checkinLabel(me.lodge.checkinMode!),
                              ),
                            ],
                            const _RowDivider(),
                            _ActionRow(
                              icon: Icons.call_rounded,
                              iconColor: AppTheme.vacant,
                              label: 'Lodge phone',
                              subtitle: me.lodge.phone ?? '—',
                              onTap: _hasText(me.lodge.phone)
                                  ? () => launchUrl(Uri.parse('tel:${me.lodge.phone}'))
                                  : null,
                            ),
                            if (_hasText(me.lodge.whatsappNumber)) ...[
                              const _RowDivider(),
                              _ActionRow(
                                icon: Icons.chat_bubble_rounded,
                                iconColor: AppTheme.vacant,
                                label: 'WhatsApp',
                                subtitle: me.lodge.whatsappNumber!,
                                onTap: () => launchUrl(
                                  Uri.parse('https://wa.me/${me.lodge.whatsappNumber}'),
                                ),
                              ),
                            ],
                            if (me.lodge.isGstRegistered) ...[
                              const _RowDivider(),
                              _InfoRow(
                                icon: Icons.receipt_long_rounded,
                                iconColor: const Color(0xFFB98900),
                                label: 'GSTIN',
                                value: me.lodge.gstin ?? '—',
                              ),
                            ],
                            if (me.lodge.latitude != null && me.lodge.longitude != null) ...[
                              const _RowDivider(),
                              _ActionRow(
                                icon: Icons.map_rounded,
                                iconColor: const Color(0xFFB98900),
                                label: 'Map pin',
                                subtitle: '${me.lodge.latitude}, ${me.lodge.longitude}',
                                onTap: () => _openMap(me.lodge.latitude!, me.lodge.longitude!),
                              ),
                            ],
                          ],
                        ),
                      ),
                      if (_hasText(me.lodge.slug)) ...[
                        const SizedBox(height: AppTheme.s16),
                        _PublicLinkCard(lodge: me.lodge),
                      ],
                      const SizedBox(height: AppTheme.s24),
                      const _SectionLabel('Security', icon: Icons.shield_outlined),
                      const SizedBox(height: AppTheme.s12),
                      NeuCard(
                        padding: EdgeInsets.zero,
                        onTap: () => _openChangePassword(context, ref),
                        child: const _ActionRow(
                          icon: Icons.lock_rounded,
                          iconColor: Color(0xFF7C5CFF),
                          label: 'Change password',
                          subtitle: 'A code is sent to your phone to confirm it',
                          forceChevron: true,
                        ),
                      ),
                      const SizedBox(height: AppTheme.s32),
                      Material(
                        color: AppTheme.danger.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(AppTheme.rMedium),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(AppTheme.rMedium),
                          onTap: () => _confirmSignOut(context, ref),
                          child: const Padding(
                            padding: EdgeInsets.symmetric(vertical: AppTheme.s16),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  Icons.logout_rounded,
                                  size: 18,
                                  color: AppTheme.danger,
                                ),
                                SizedBox(width: AppTheme.s8),
                                Text(
                                  'Sign out',
                                  style: TextStyle(
                                    color: AppTheme.danger,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 15,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ]),
                  ),
                ),
              ],
                ),
              ),
            ),
    );
  }

  static String _address(Lodge lodge) {
    final parts = [
      lodge.address,
      lodge.city,
      lodge.state,
    ].where((p) => p != null && p.trim().isNotEmpty).toList();
    return parts.isEmpty ? '—' : parts.join(', ');
  }

  static bool _hasText(String? value) => value != null && value.trim().isNotEmpty;

  static const _checkinLabels = {
    'HOUR_24': '24-hour cycle',
    'NIGHT_BASED': 'Night-based',
    'CYCLE': 'Fixed check-in / checkout',
  };

  static String _checkinLabel(String mode) => _checkinLabels[mode] ?? mode;

  static Future<void> _openMap(double lat, double lng) async {
    final uri = Uri.parse('https://www.google.com/maps/search/?api=1&query=$lat,$lng');
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  static Future<void> _confirmSignOut(
    BuildContext context,
    WidgetRef ref,
  ) async {
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

  static Future<void> _openChangePassword(BuildContext context, WidgetRef ref) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _ChangePasswordSheet(),
    );
  }

  static Future<void> _openEditLodge(BuildContext context, WidgetRef ref, Lodge lodge) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _EditLodgeSheet(lodge: lodge),
    );
  }
}

/// A sheet's bottom-anchored, rounded-top card — the shared shell for both
/// the edit and change-password flows below, keeping the keyboard visible by
/// resizing to it rather than being pushed off-screen.
class _Sheet extends StatelessWidget {
  final String title;
  final Widget child;

  const _Sheet({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        decoration: const BoxDecoration(
          color: AppTheme.bg,
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.rLarge)),
        ),
        padding: const EdgeInsets.fromLTRB(
          AppTheme.s24,
          AppTheme.s16,
          AppTheme.s24,
          AppTheme.s24,
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: AppTheme.s16),
                  decoration: BoxDecoration(
                    color: AppTheme.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(
                title,
                style: const TextStyle(
                  color: AppTheme.heading,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: AppTheme.s16),
              child,
            ],
          ),
        ),
      ),
    );
  }
}

// ── Header ────────────────────────────────────────────────────────────────

class _Header extends ConsumerWidget {
  final Me me;

  const _Header({required this.me});

  static const double _bannerExtra = 68;
  static const double _navHeight = 48;
  static const double _avatarSize = 76;
  static const double _cardEstHeight = 158;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final initial = me.user.name.isNotEmpty
        ? me.user.name[0].toUpperCase()
        : '?';
    final safeTop = MediaQuery.of(context).padding.top;
    final bannerHeight = safeTop + _navHeight + _bannerExtra;
    final avatarTop = bannerHeight - _avatarSize / 2;
    final cardTop = bannerHeight;

    return SizedBox(
      height: cardTop + _cardEstHeight,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // ── Gradient banner ──────────────────────────────────────────
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: bannerHeight,
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(
                bottom: Radius.circular(AppTheme.rLarge),
              ),
              child: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppTheme.accent, Color(0xFF434190)],
                  ),
                ),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    // Soft decorative blobs — just enough shape to feel
                    // designed without drawing custom art.
                    Positioned(
                      right: -20,
                      top: -20,
                      child: Container(
                        width: 90,
                        height: 90,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withValues(alpha: 0.08),
                        ),
                      ),
                    ),
                    Positioned(
                      right: 28,
                      top: 18,
                      child: Icon(
                        Icons.cottage_rounded,
                        size: 34,
                        color: Colors.white.withValues(alpha: 0.28),
                      ),
                    ),
                    Positioned(
                      left: -16,
                      bottom: -30,
                      child: Container(
                        width: 70,
                        height: 70,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withValues(alpha: 0.06),
                        ),
                      ),
                    ),
                    Padding(
                      padding: EdgeInsets.only(top: safeTop),
                      child: SizedBox(
                        height: _navHeight,
                        child: Row(
                          children: [
                            IconButton(
                              onPressed: () => Navigator.of(context).maybePop(),
                              icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
                              visualDensity: VisualDensity.compact,
                            ),
                            const Expanded(
                              child: Text(
                                'Profile',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 18,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            const SizedBox(width: 40),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // ── Identity card ────────────────────────────────────────────
          Positioned(
            top: cardTop,
            left: AppTheme.s16,
            right: AppTheme.s16,
            child: NeuCard(
              padding: EdgeInsets.fromLTRB(
                AppTheme.s16,
                _avatarSize / 2 + AppTheme.s12,
                AppTheme.s16,
                AppTheme.s16,
              ),
              shadow: AppTheme.elevated,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    me.user.name,
                    style: const TextStyle(
                      color: AppTheme.heading,
                      fontSize: 19,
                      fontWeight: FontWeight.w700,
                    ),
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: AppTheme.s8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppTheme.accent.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      (me.user.roleName ?? me.user.role).toUpperCase(),
                      style: const TextStyle(
                        color: AppTheme.accent,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.4,
                      ),
                    ),
                  ),
                  const SizedBox(height: AppTheme.s16),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppTheme.bg,
                      borderRadius: BorderRadius.circular(AppTheme.rSmall),
                      border: Border.all(color: AppTheme.border),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.storefront_rounded, size: 15, color: AppTheme.accent),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            me.lodge.name,
                            style: const TextStyle(
                              color: AppTheme.text,
                              fontSize: 13.5,
                              fontWeight: FontWeight.w600,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          // ── Avatar, straddling the seam ──────────────────────────────
          Positioned(
            top: avatarTop,
            left: 0,
            right: 0,
            child: Center(
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    width: _avatarSize,
                    height: _avatarSize,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppTheme.card,
                      shape: BoxShape.circle,
                      border: Border.all(color: AppTheme.card, width: 4),
                      boxShadow: AppTheme.elevated,
                    ),
                    child: Container(
                      decoration: BoxDecoration(
                        color: AppTheme.accent.withValues(alpha: 0.12),
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: Text(
                          initial,
                          style: const TextStyle(
                            color: AppTheme.accent,
                            fontSize: 28,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    right: 2,
                    bottom: 2,
                    child: Container(
                      width: 16,
                      height: 16,
                      decoration: BoxDecoration(
                        color: AppTheme.vacant,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppTheme.card, width: 2),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Rows and chips ────────────────────────────────────────────────────────

class _SectionLabel extends StatelessWidget {
  final String text;
  final IconData icon;

  const _SectionLabel(this.text, {required this.icon});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 14, color: AppTheme.accent),
        const SizedBox(width: 6),
        Text(
          text.toUpperCase(),
          style: const TextStyle(
            color: AppTheme.muted,
            fontSize: 12,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.6,
          ),
        ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String label;
  final String value;

  const _InfoRow({
    required this.icon,
    this.iconColor = AppTheme.accent,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s16,
        vertical: AppTheme.s12,
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
            ),
            child: Icon(icon, size: 17, color: iconColor),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 14.5,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RowDivider extends StatelessWidget {
  const _RowDivider();

  @override
  Widget build(BuildContext context) {
    return const Divider(height: 1, color: AppTheme.border, indent: AppTheme.s16, endIndent: AppTheme.s16);
  }
}

/// A tappable settings row — an icon, a label and an optional subtitle, with
/// a trailing chevron. Used for actions rather than plain facts.
class _ActionRow extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String label;
  final String? subtitle;
  final VoidCallback? onTap;

  /// Shows the trailing chevron even with no [onTap] of its own — for rows
  /// whose tap target is the surrounding [NeuCard] instead.
  final bool forceChevron;

  const _ActionRow({
    required this.icon,
    this.iconColor = AppTheme.accent,
    required this.label,
    this.subtitle,
    this.onTap,
    this.forceChevron = false,
  });

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.s16,
        vertical: AppTheme.s12,
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
            ),
            child: Icon(icon, size: 17, color: iconColor),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontSize: 14.5,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                  ),
                ],
              ],
            ),
          ),
          if (onTap != null || forceChevron)
            const Icon(Icons.chevron_right_rounded, color: AppTheme.muted, size: 20),
        ],
      ),
    );
    return onTap == null ? row : GestureDetector(onTap: onTap, child: row);
  }
}

/// The property's guest-facing page — the same link the web dashboard's
/// "Hotel profile" panel offers to copy. Rooms properties link to the
/// booking page; a restaurant with no rooms links to the ordering page.
class _PublicLinkCard extends StatefulWidget {
  final Lodge lodge;

  const _PublicLinkCard({required this.lodge});

  @override
  State<_PublicLinkCard> createState() => _PublicLinkCardState();
}

class _PublicLinkCardState extends State<_PublicLinkCard> {
  bool _copied = false;

  String get _url =>
      '$baseUrl${widget.lodge.hasRooms ? '/lodge/${widget.lodge.slug}' : '/order/${widget.lodge.slug}'}';

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: _url));
    setState(() => _copied = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.accent.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
            ),
            child: const Icon(Icons.public_rounded, size: 19, color: AppTheme.accent),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Public link',
                  style: TextStyle(
                    color: AppTheme.heading,
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'View this profile publicly',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                ),
              ],
            ),
          ),
          _CircleIconButton(
            icon: _copied ? Icons.check_rounded : Icons.copy_rounded,
            onTap: _copy,
            tooltip: 'Copy link',
          ),
          const SizedBox(width: AppTheme.s8),
          _CircleIconButton(
            icon: Icons.open_in_new_rounded,
            onTap: () => launchUrl(Uri.parse(_url), mode: LaunchMode.externalApplication),
            tooltip: 'Open link',
          ),
        ],
      ),
    );
  }
}

class _CircleIconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  final String tooltip;

  const _CircleIconButton({required this.icon, required this.onTap, required this.tooltip});

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: AppTheme.bg,
        shape: const CircleBorder(side: BorderSide(color: AppTheme.border)),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 34,
            height: 34,
            child: Icon(icon, size: 16, color: AppTheme.text),
          ),
        ),
      ),
    );
  }
}

// ── Edit property (owner-only) ───────────────────────────────────────────

class _EditLodgeSheet extends ConsumerStatefulWidget {
  final Lodge lodge;

  const _EditLodgeSheet({required this.lodge});

  @override
  ConsumerState<_EditLodgeSheet> createState() => _EditLodgeSheetState();
}

class _EditLodgeSheetState extends ConsumerState<_EditLodgeSheet> {
  late final _name = TextEditingController(text: widget.lodge.name);
  late final _gstin = TextEditingController(text: widget.lodge.gstin ?? '');
  late final _phone = TextEditingController(text: widget.lodge.phone ?? '');
  late final _whatsapp = TextEditingController(text: widget.lodge.whatsappNumber ?? '');
  late final _address = TextEditingController(text: widget.lodge.address ?? '');
  late final _city = TextEditingController(text: widget.lodge.city ?? '');
  late final _state = TextEditingController(text: widget.lodge.state ?? '');
  late final _latitude = TextEditingController(
    text: widget.lodge.latitude?.toString() ?? '',
  );
  late final _longitude = TextEditingController(
    text: widget.lodge.longitude?.toString() ?? '',
  );
  late final _nameMr = TextEditingController(text: widget.lodge.nameMr ?? '');
  late final _addressMr = TextEditingController(text: widget.lodge.addressMr ?? '');

  bool _saving = false;
  bool _locating = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _gstin.dispose();
    _phone.dispose();
    _whatsapp.dispose();
    _address.dispose();
    _city.dispose();
    _state.dispose();
    _latitude.dispose();
    _longitude.dispose();
    _nameMr.dispose();
    _addressMr.dispose();
    super.dispose();
  }

  Future<void> _useCurrentLocation() async {
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw 'Turn on location services and try again.';
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw 'Location permission was denied.';
      }
      final position = await Geolocator.getCurrentPosition();
      setState(() {
        _latitude.text = position.latitude.toStringAsFixed(6);
        _longitude.text = position.longitude.toStringAsFixed(6);
      });
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _clearPin() {
    setState(() {
      _latitude.clear();
      _longitude.clear();
    });
  }

  Future<void> _viewOnMap() async {
    final lat = double.tryParse(_latitude.text.trim());
    final lng = double.tryParse(_longitude.text.trim());
    if (lat == null || lng == null) return;
    await ProfileScreen._openMap(lat, lng);
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter the property name.');
      return;
    }
    if (widget.lodge.isGstRegistered && _gstin.text.trim().isEmpty) {
      setState(() => _error = 'Enter the GSTIN, or ask Vengurla Tech to turn off GST registration.');
      return;
    }
    final lat = _latitude.text.trim();
    final lng = _longitude.text.trim();
    if (lat.isEmpty != lng.isEmpty) {
      setState(() => _error = 'Enter both latitude and longitude, or leave both empty.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(authViewModelProvider.notifier).updateMyLodge({
        'lodgeName': _name.text.trim(),
        'phone': _phone.text.trim(),
        'whatsappNumber': _whatsapp.text.trim(),
        'address': _address.text.trim(),
        'city': _city.text.trim(),
        'state': _state.text.trim(),
        'latitude': lat.isEmpty ? null : double.tryParse(lat),
        'longitude': lng.isEmpty ? null : double.tryParse(lng),
        'lodgeNameMr': _nameMr.text.trim(),
        'addressMr': _addressMr.text.trim(),
        if (widget.lodge.isGstRegistered) 'gstin': _gstin.text.trim(),
      });
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Property details updated.')),
        );
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _Sheet(
      title: 'Edit hotel profile',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: NeuField(controller: _name, label: 'Name', required: true),
              ),
              const SizedBox(width: AppTheme.s12),
              Expanded(
                child: NeuField(
                  controller: _gstin,
                  label: 'GSTIN',
                  hint: widget.lodge.isGstRegistered ? '27ABCDE1234F1Z5' : 'Not GST registered',
                  readOnly: !widget.lodge.isGstRegistered,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: NeuField(
                  controller: _phone,
                  label: 'Phone',
                  keyboardType: TextInputType.phone,
                ),
              ),
              const SizedBox(width: AppTheme.s12),
              Expanded(
                child: NeuField(
                  controller: _whatsapp,
                  label: 'WhatsApp number',
                  keyboardType: TextInputType.phone,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s16),
          NeuField(controller: _address, label: 'Address'),
          const SizedBox(height: AppTheme.s16),
          Row(
            children: [
              Expanded(child: NeuField(controller: _city, label: 'City')),
              const SizedBox(width: AppTheme.s12),
              Expanded(child: NeuField(controller: _state, label: 'State')),
            ],
          ),
          const SizedBox(height: AppTheme.s16),
          const Text(
            'Map location',
            style: TextStyle(color: AppTheme.muted, fontSize: 12.5, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              Expanded(
                child: NeuField(
                  controller: _latitude,
                  label: 'Latitude',
                  keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                ),
              ),
              const SizedBox(width: AppTheme.s12),
              Expanded(
                child: NeuField(
                  controller: _longitude,
                  label: 'Longitude',
                  keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Wrap(
            spacing: AppTheme.s12,
            runSpacing: AppTheme.s8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _LinkButton(
                icon: Icons.my_location_rounded,
                label: _locating ? 'Locating…' : 'Use my current location',
                onTap: _locating ? null : _useCurrentLocation,
              ),
              _LinkButton(
                icon: Icons.close_rounded,
                label: 'Clear pin',
                onTap: _clearPin,
              ),
              if (_latitude.text.trim().isNotEmpty && _longitude.text.trim().isNotEmpty)
                _LinkButton(
                  icon: Icons.map_outlined,
                  label: 'Check on Google Maps',
                  onTap: _viewOnMap,
                ),
            ],
          ),
          const SizedBox(height: AppTheme.s16),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: NeuField(controller: _nameMr, label: 'Name in Marathi (bill masthead)'),
              ),
              const SizedBox(width: AppTheme.s12),
              Expanded(
                child: NeuField(controller: _addressMr, label: 'Address in Marathi'),
              ),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: AppTheme.s12),
            Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12.5)),
          ],
          const SizedBox(height: AppTheme.s24),
          NeuButton(
            primary: true,
            expand: true,
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Save changes'),
          ),
        ],
      ),
    );
  }
}

class _LinkButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  const _LinkButton({required this.icon, required this.label, this.onTap});

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return GestureDetector(
      onTap: onTap,
      child: Opacity(
        opacity: enabled ? 1 : 0.5,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: AppTheme.accent),
            const SizedBox(width: 4),
            Text(
              label,
              style: const TextStyle(
                color: AppTheme.accent,
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Change password ──────────────────────────────────────────────────────

/// The same two-step flow as the web dashboard: the current password is
/// checked and a 6-digit code is texted over WhatsApp, then the new password
/// is applied together with that code — so a stolen "forgot password" link
/// alone is never enough to take over a login.
class _ChangePasswordSheet extends ConsumerStatefulWidget {
  const _ChangePasswordSheet();

  @override
  ConsumerState<_ChangePasswordSheet> createState() => _ChangePasswordSheetState();
}

class _ChangePasswordSheetState extends ConsumerState<_ChangePasswordSheet> {
  final _currentPassword = TextEditingController();
  final _newPassword = TextEditingController();
  final _confirmPassword = TextEditingController();
  final _otp = TextEditingController();

  bool _codeSent = false;
  bool _busy = false;
  String? _error;
  String? _maskedPhone;

  @override
  void dispose() {
    _currentPassword.dispose();
    _newPassword.dispose();
    _confirmPassword.dispose();
    _otp.dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    if (_currentPassword.text.isEmpty) {
      setState(() => _error = 'Enter your current password.');
      return;
    }
    if (_newPassword.text.length < 8) {
      setState(() => _error = 'New password must be at least 8 characters.');
      return;
    }
    if (_newPassword.text != _confirmPassword.text) {
      setState(() => _error = 'Passwords do not match.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(authViewModelProvider.notifier)
          .sendPasswordOtp(_currentPassword.text);
      setState(() {
        _codeSent = true;
        _maskedPhone = result['phone']?.toString();
      });
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm() async {
    if (!RegExp(r'^\d{6}$').hasMatch(_otp.text.trim())) {
      setState(() => _error = 'Enter the 6-digit code sent to your phone.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authViewModelProvider.notifier).changePassword(
            currentPassword: _currentPassword.text,
            newPassword: _newPassword.text,
            otp: _otp.text.trim(),
          );
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Password changed.')),
        );
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _Sheet(
      title: 'Change password',
      child: _codeSent ? _codeStep() : _detailsStep(),
    );
  }

  Widget _detailsStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        NeuField(
          controller: _currentPassword,
          label: 'Current password',
          obscure: true,
          required: true,
        ),
        const SizedBox(height: AppTheme.s16),
        NeuField(
          controller: _newPassword,
          label: 'New password',
          hint: 'At least 8 characters',
          obscure: true,
          required: true,
        ),
        const SizedBox(height: AppTheme.s16),
        NeuField(
          controller: _confirmPassword,
          label: 'Confirm new password',
          obscure: true,
          required: true,
        ),
        if (_error != null) ...[
          const SizedBox(height: AppTheme.s12),
          Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12.5)),
        ],
        const SizedBox(height: AppTheme.s24),
        NeuButton(
          primary: true,
          expand: true,
          onPressed: _busy ? null : _requestCode,
          child: _busy
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Text('Send code'),
        ),
      ],
    );
  }

  Widget _codeStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          _maskedPhone == null
              ? 'Enter the 6-digit code sent to your phone.'
              : 'Enter the 6-digit code sent to $_maskedPhone.',
          style: const TextStyle(color: AppTheme.text, fontSize: 13.5),
        ),
        const SizedBox(height: AppTheme.s16),
        NeuField(
          controller: _otp,
          label: 'Verification code',
          hint: '••••••',
          keyboardType: TextInputType.number,
          maxLength: 6,
          required: true,
        ),
        if (_error != null) ...[
          const SizedBox(height: AppTheme.s12),
          Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12.5)),
        ],
        const SizedBox(height: AppTheme.s16),
        NeuButton(
          primary: true,
          expand: true,
          onPressed: _busy ? null : _confirm,
          child: _busy
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : const Text('Change password'),
        ),
        const SizedBox(height: AppTheme.s8),
        TextButton(
          onPressed: _busy
              ? null
              : () {
                  setState(() {
                    _codeSent = false;
                    _otp.clear();
                    _error = null;
                  });
                },
          child: const Text('Change details / resend code'),
        ),
      ],
    );
  }
}
