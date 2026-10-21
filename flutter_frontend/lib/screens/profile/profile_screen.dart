import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/constant.dart';
import '../../domain/models/me.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../shell/sign_out_dialog.dart';
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
                      const _SectionLabel('Contact', icon: Icons.person_outline_rounded),
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
                            if (_hasText(me.user.email)) ...[
                              const _RowDivider(),
                              _ActionRow(
                                icon: Icons.email_rounded,
                                iconColor: const Color(0xFFE0457C),
                                label: 'Email',
                                subtitle: me.user.email,
                                onTap: null,
                              ),
                            ],
                            const _RowDivider(),
                            _ActionRow(
                              icon: Icons.call_rounded,
                              iconColor: AppTheme.vacant,
                              label: 'Phone',
                              subtitle: me.user.phone ?? '—',
                              onTap: null,
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
                              onTap: null,
                            ),
                            if (_hasText(me.lodge.whatsappNumber)) ...[
                              const _RowDivider(),
                              _ActionRow(
                                icon: Icons.chat_bubble_rounded,
                                iconColor: AppTheme.vacant,
                                label: 'WhatsApp',
                                subtitle: me.lodge.whatsappNumber!,
                                onTap: null,
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
                      if (me.user.role == 'OWNER') ...[
                        const SizedBox(height: AppTheme.s16),
                        _LogoSection(lodge: me.lodge),
                        const SizedBox(height: AppTheme.s12),
                        _HeroImageSection(lodge: me.lodge),
                      ],
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
    final ok = await showSignOutDialog(context);
    if (ok == true) {
      await ref.read(authViewModelProvider.notifier).signOut();
      // ProfileScreen is pushed on top of DashboardShell, which sits inside
      // AuthGate's single root route. Signing out swaps AuthGate's child to
      // LoginScreen, but that happens underneath this pushed route — without
      // popping back to root, this screen stays on top showing its "me is
      // null" spinner forever instead of the login screen.
      if (context.mounted) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    }
  }

  static Future<void> _openChangePassword(BuildContext context, WidgetRef ref) {
    return showDialog(
      context: context,
      builder: (_) => const _ChangePasswordSheet(),
    );
  }

  static Future<void> _openEditLodge(BuildContext context, WidgetRef ref, Lodge lodge) {
    return Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => _EditLodgeSheet(lodge: lodge)),
    );
  }
}

/// A sheet's bottom-anchored, rounded-top card — the shared shell for both
/// the edit and change-password flows below, keeping the keyboard visible by
/// resizing to it rather than being pushed off-screen.
class _Sheet extends StatelessWidget {
  final String title;
  final Widget child;

  /// Shows as a centred popup dialog instead of a bottom-anchored sheet.
  final bool dialog;

  const _Sheet({required this.title, required this.child, this.dialog = false});

  @override
  Widget build(BuildContext context) {
    if (dialog) {
      return Dialog(
        backgroundColor: AppTheme.bg,
        insetPadding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s24),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rLarge)),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(AppTheme.s24, AppTheme.s16, AppTheme.s8, 0),
                child: Row(
                  children: [
                    Expanded(child: Text(title, style: Theme.of(context).textTheme.titleLarge)),
                    IconButton(
                      icon: const Icon(Icons.close_rounded, size: 20),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(
                    AppTheme.s24,
                    AppTheme.s16,
                    AppTheme.s24,
                    AppTheme.s24,
                  ),
                  child: child,
                ),
              ),
            ],
          ),
        ),
      );
    }
    final maxHeight = MediaQuery.of(context).size.height * 0.9;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxHeight),
        child: Container(
          decoration: const BoxDecoration(
            color: AppTheme.bg,
            borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.rLarge)),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppTheme.s24,
                    AppTheme.s16,
                    AppTheme.s24,
                    0,
                  ),
                  child: Column(
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
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                    ],
                  ),
                ),
                Flexible(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(
                      AppTheme.s24,
                      AppTheme.s16,
                      AppTheme.s24,
                      AppTheme.s24,
                    ),
                    child: child,
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
                    colors: [AppTheme.accent, Color(0xFF10499A)],
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
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
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
                  style: AppTheme.fieldLabel(context),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontSize: 14.5),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
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
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontSize: 14.5),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: Theme.of(context).textTheme.bodySmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
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
      '$baseUrl${widget.lodge.hasRooms ? '/hotel/${widget.lodge.slug}' : '/order/${widget.lodge.slug}'}';

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
                Text(
                  'Public link',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontSize: 13.5),
                ),
                const SizedBox(height: 2),
                Text(
                  'View this profile publicly',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(fontSize: 11.5),
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

/// The property's logo — shown before its name on the dashboard, and on the
/// printed bill masthead once [Lodge.showLogoOnReceipt] is turned on (see
/// the checkbox in [_EditLodgeSheet]). Owner-only, mirroring the web's
/// HotelProfileModal logo controls.
class _LogoSection extends ConsumerStatefulWidget {
  final Lodge lodge;

  const _LogoSection({required this.lodge});

  @override
  ConsumerState<_LogoSection> createState() => _LogoSectionState();
}

class _LogoSectionState extends ConsumerState<_LogoSection> {
  bool _busy = false;
  String? _error;

  Future<void> _pickAndUpload() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 90,
    );
    if (picked == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final form = dio.FormData.fromMap({
        'logo': await dio.MultipartFile.fromFile(picked.path, filename: picked.name),
      });
      await ref.read(authViewModelProvider.notifier).updateMyLodgeLogo(form);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmRemove() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Remove logo?', style: TextStyle(color: AppTheme.heading)),
        content: const Text(
          'It will no longer show on the dashboard or on printed bills.',
          style: TextStyle(color: AppTheme.text),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authViewModelProvider.notifier).removeMyLodgeLogo();
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lodge = widget.lodge;
    final hasLogo = ProfileScreen._hasText(lodge.logoUrl);
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(
                  color: AppTheme.bg,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppTheme.border),
                ),
                child: hasLogo
                    ? Image.network(
                        '$baseUrl${lodge.logoUrl}',
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) =>
                            _monogram(lodge.name),
                      )
                    : _monogram(lodge.name),
              ),
              const SizedBox(width: AppTheme.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Hotel logo',
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(fontSize: 13.5),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      !hasLogo
                          ? 'Shown before the name once uploaded.'
                          : (lodge.showLogoOnReceipt
                              ? 'Shown on the dashboard and printed bills.'
                              : 'Shown on the dashboard only — turn on printing it under Edit.'),
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(fontSize: 11.5),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: AppTheme.s8),
            Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12.5)),
          ],
          const SizedBox(height: AppTheme.s12),
          Wrap(
            spacing: AppTheme.s12,
            runSpacing: AppTheme.s8,
            children: [
              _LinkButton(
                icon: Icons.upload_rounded,
                label: _busy
                    ? 'Uploading…'
                    : (hasLogo ? 'Replace logo' : 'Upload logo'),
                onTap: _busy ? null : _pickAndUpload,
              ),
              if (hasLogo)
                _LinkButton(
                  icon: Icons.delete_outline_rounded,
                  label: 'Remove',
                  onTap: _busy ? null : _confirmRemove,
                ),
            ],
          ),
        ],
      ),
    );
  }

  static Widget _monogram(String name) => Center(
    child: Text(
      name.isNotEmpty ? name[0].toUpperCase() : '?',
      style: const TextStyle(
        color: AppTheme.accent,
        fontSize: 18,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
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
  late bool _showLogoOnReceipt = widget.lodge.showLogoOnReceipt;

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
        if (ProfileScreen._hasText(widget.lodge.logoUrl))
          'showLogoOnReceipt': _showLogoOnReceipt,
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
    final lodge = widget.lodge;
    final hasLogo = ProfileScreen._hasText(lodge.logoUrl);
    final hasPin = _latitude.text.trim().isNotEmpty && _longitude.text.trim().isNotEmpty;

    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: Text(
          'Edit hotel profile',
          overflow: TextOverflow.ellipsis,
          maxLines: 1,
        ),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s16),
              children: [
                _EditLodgeHeader(lodge: lodge),
                const SizedBox(height: AppTheme.s12),
                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.elevated,
                  padding: const EdgeInsets.all(AppTheme.s12 + 2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_error != null) ...[
                        _EditErrorBanner(_error!),
                        const SizedBox(height: AppTheme.s12),
                      ],

                      const SectionLabel('Property', number: 1, icon: Icons.storefront_rounded),
                      const SizedBox(height: AppTheme.s12),
                      _FieldPair(
                        first: NeuField(
                          dense: true,
                          controller: _name,
                          label: 'Name',
                          required: true,
                          forceCapitalizeWords: true,
                        ),
                        second: NeuField(
                          dense: true,
                          controller: _gstin,
                          label: 'GSTIN',
                          hint: lodge.isGstRegistered ? '27ABCDE1234F1Z5' : 'Not GST registered',
                          readOnly: !lodge.isGstRegistered,
                        ),
                      ),

                      const SectionDivider(),
                      const SectionLabel('Contact', number: 2, icon: Icons.call_rounded),
                      const SizedBox(height: AppTheme.s12),
                      _FieldPair(
                        first: NeuField(
                          dense: true,
                          controller: _phone,
                          label: 'Phone',
                          keyboardType: TextInputType.phone,
                          hint: '9876543210',
                        ),
                        second: NeuField(
                          dense: true,
                          controller: _whatsapp,
                          label: 'WhatsApp number',
                          keyboardType: TextInputType.phone,
                          hint: '9876543210',
                        ),
                      ),

                      const SectionDivider(),
                      const SectionLabel('Address', number: 3, icon: Icons.location_on_rounded),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(dense: true, controller: _address, label: 'Street address'),
                      const SizedBox(height: AppTheme.s8),
                      _FieldPair(
                        first: NeuField(dense: true, controller: _city, label: 'City'),
                        second: NeuField(dense: true, controller: _state, label: 'State'),
                      ),

                      const SectionDivider(),
                      const SectionLabel('Map location', number: 4, icon: Icons.map_rounded),
                      const SizedBox(height: AppTheme.s12),
                      _FieldPair(
                        alwaysRow: true,
                        first: NeuField(
                          dense: true,
                          controller: _latitude,
                          label: 'Latitude',
                          keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                          onChanged: (_) => setState(() {}),
                        ),
                        second: NeuField(
                          dense: true,
                          controller: _longitude,
                          label: 'Longitude',
                          keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                          onChanged: (_) => setState(() {}),
                        ),
                      ),
                      const SizedBox(height: AppTheme.s8),
                      Wrap(
                        spacing: AppTheme.s8,
                        runSpacing: AppTheme.s8,
                        children: [
                          _PillButton(
                            icon: Icons.my_location_rounded,
                            label: _locating ? 'Locating…' : 'Use current location',
                            onTap: _locating ? null : _useCurrentLocation,
                            filled: true,
                          ),
                          if (hasPin) ...[
                            _PillButton(
                              icon: Icons.map_outlined,
                              label: 'View on map',
                              onTap: _viewOnMap,
                            ),
                            _PillButton(
                              icon: Icons.close_rounded,
                              label: 'Clear',
                              onTap: _clearPin,
                            ),
                          ],
                        ],
                      ),

                      const SectionDivider(),
                      const SectionLabel('Bill masthead', number: 5, icon: Icons.receipt_long_rounded),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(dense: true, controller: _nameMr, label: 'Name in Marathi'),
                      const SizedBox(height: AppTheme.s8),
                      NeuField(dense: true, controller: _addressMr, label: 'Address in Marathi'),
                      if (hasLogo) ...[
                        const SizedBox(height: AppTheme.s12),
                        Container(
                          padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s4, AppTheme.s8),
                          decoration: BoxDecoration(
                            color: AppTheme.accent.withValues(alpha: 0.06),
                            borderRadius: BorderRadius.circular(AppTheme.rSmall),
                            border: Border.all(color: AppTheme.accent.withValues(alpha: 0.18)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.image_outlined, size: 18, color: AppTheme.accent),
                              const SizedBox(width: AppTheme.s8),
                              const Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Logo on printed bills',
                                      style: TextStyle(
                                        color: AppTheme.heading,
                                        fontSize: 13.5,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    SizedBox(height: 2),
                                    Text(
                                      'Prints above the hotel name.',
                                      style: TextStyle(color: AppTheme.muted, fontSize: 11.5),
                                    ),
                                  ],
                                ),
                              ),
                              Switch(
                                value: _showLogoOnReceipt,
                                onChanged: (v) => setState(() => _showLogoOnReceipt = v),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s16),
                _actions(context),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _actions(BuildContext context) {
    return Row(
                  children: [
                    Expanded(
                      child: NeuButton(
                        expand: true,
                        onPressed: _saving ? null : () => Navigator.pop(context),
                        child: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    Expanded(
                      flex: 2,
                      child: NeuButton(
                        primary: true,
                        expand: true,
                        onPressed: _saving ? null : _save,
                        child: _saving
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Save changes'),
                      ),
                    ),
                  ],
    );
  }
}

/// A compact identity strip atop the edit form — the logo (or monogram) and
/// the property's current name, so the owner can see what they're editing.
class _EditLodgeHeader extends StatelessWidget {
  final Lodge lodge;

  const _EditLodgeHeader({required this.lodge});

  @override
  Widget build(BuildContext context) {
    final hasLogo = ProfileScreen._hasText(lodge.logoUrl);
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppTheme.accent, Color(0xFF10499A)],
        ),
        borderRadius: BorderRadius.circular(AppTheme.rLarge),
        boxShadow: const [
          BoxShadow(color: Color(0x331457AD), offset: Offset(0, 4), blurRadius: 12),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white.withValues(alpha: 0.6), width: 2),
            ),
            child: hasLogo
                ? Image.network(
                    '$baseUrl${lodge.logoUrl}',
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) =>
                        _LogoSectionState._monogram(lodge.name),
                  )
                : _LogoSectionState._monogram(lodge.name),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  lodge.name,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15.5,
                    fontWeight: FontWeight.w700,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  'Shown on bills, receipts and your public page',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.8),
                    fontSize: 11.5,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Two fields side by side on wider screens, stacked on narrow phones.
/// [alwaysRow] keeps short paired values (like coordinates) on one line.
class _FieldPair extends StatelessWidget {
  final Widget first;
  final Widget second;
  final bool alwaysRow;

  const _FieldPair({required this.first, required this.second, this.alwaysRow = false});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (alwaysRow || constraints.maxWidth >= 420) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: first),
              const SizedBox(width: AppTheme.s12),
              Expanded(child: second),
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [first, const SizedBox(height: AppTheme.s8), second],
        );
      },
    );
  }
}

class _PillButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool filled;

  const _PillButton({required this.icon, required this.label, this.onTap, this.filled = false});

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: Material(
        color: filled ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.card,
        shape: StadiumBorder(
          side: BorderSide(color: filled ? AppTheme.accent.withValues(alpha: 0.25) : AppTheme.border),
        ),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 7),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 14, color: AppTheme.accent),
                const SizedBox(width: 6),
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
        ),
      ),
    );
  }
}

class _EditErrorBanner extends StatelessWidget {
  final String message;
  const _EditErrorBanner(this.message);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.danger.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
          const SizedBox(width: AppTheme.s8),
          Expanded(child: Text(message, style: const TextStyle(color: AppTheme.danger, fontSize: 13))),
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
      dialog: true,
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
          style: Theme.of(context)
              .textTheme
              .bodyMedium
              ?.copyWith(fontSize: 13.5),
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

/// The public page's hero background. Left unset, the page falls back to the
/// first room/venue photo. Owner-only, mirrors HotelProfileModal's hero
/// image controls on the web.
class _HeroImageSection extends ConsumerStatefulWidget {
  final Lodge lodge;

  const _HeroImageSection({required this.lodge});

  @override
  ConsumerState<_HeroImageSection> createState() => _HeroImageSectionState();
}

class _HeroImageSectionState extends ConsumerState<_HeroImageSection> {
  bool _busy = false;
  String? _error;

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickAndUpload() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null) return;
    await _run(() async {
      final form = dio.FormData.fromMap({
        'heroImage': await dio.MultipartFile.fromFile(picked.path, filename: picked.name),
      });
      await ref.read(authViewModelProvider.notifier).updateMyLodgeHeroImage(form);
    });
  }

  Future<void> _remove() => _run(() => ref.read(authViewModelProvider.notifier).removeMyLodgeHeroImage());

  @override
  Widget build(BuildContext context) {
    final url = widget.lodge.heroImageUrl;
    final hasHero = ProfileScreen._hasText(url);
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Public page hero image', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontSize: 13.5)),
          const SizedBox(height: 2),
          Text(
            hasHero
                ? 'Shown as the background of your public page.'
                : 'Not set — the first room or venue photo is used instead.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 11.5),
          ),
          if (hasHero) ...[
            const SizedBox(height: AppTheme.s12),
            ClipRRect(
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
              child: AspectRatio(
                aspectRatio: 16 / 6,
                child: Image.network(
                  '$baseUrl$url',
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) => Container(color: AppTheme.bg),
                ),
              ),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: AppTheme.s8),
            Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12.5)),
          ],
          const SizedBox(height: AppTheme.s12),
          Wrap(
            spacing: AppTheme.s12,
            runSpacing: AppTheme.s8,
            children: [
              _LinkButton(
                icon: Icons.upload_rounded,
                label: _busy ? 'Uploading…' : (hasHero ? 'Replace image' : 'Upload image'),
                onTap: _busy ? null : _pickAndUpload,
              ),
              if (hasHero)
                _LinkButton(
                  icon: Icons.delete_outline_rounded,
                  label: 'Remove',
                  onTap: _busy ? null : _remove,
                ),
            ],
          ),
        ],
      ),
    );
  }
}
