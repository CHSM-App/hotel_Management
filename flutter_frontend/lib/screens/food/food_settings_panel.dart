import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/food_settings_viewmodel.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// Menu & QR codes > Settings — mirrors FoodSettingsPanel.jsx: three switches
/// held locally until one Save, not three independent PATCHes.
class FoodSettingsPanel extends ConsumerStatefulWidget {
  const FoodSettingsPanel({super.key});

  @override
  ConsumerState<FoodSettingsPanel> createState() => _FoodSettingsPanelState();
}

class _FoodSettingsPanelState extends ConsumerState<FoodSettingsPanel> {
  bool _showInfo = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(
      () => ref.read(foodSettingsViewModelProvider.notifier).load(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(foodSettingsViewModelProvider);
    final vm = ref.read(foodSettingsViewModelProvider.notifier);
    final settings = state.settings;

    if (state.isLoading && settings == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.error != null && settings == null) {
      return NeuNotice(
        icon: Icons.cloud_off_rounded,
        message: state.error!,
        action: NeuButton(onPressed: vm.load, child: const Text('Try again')),
      );
    }
    if (settings == null) return const SizedBox.shrink();

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.s12,
        AppTheme.s4,
        AppTheme.s12,
        AppTheme.s24,
      ),
      children: [
        if (state.error != null) ...[
          _ErrorBanner(state.error!),
          const SizedBox(height: AppTheme.s12),
        ],
        NeuCard(
          padding: const EdgeInsets.all(AppTheme.s12),
          child: _Toggle(
            icon: Icons.restaurant_rounded,
            title: 'This property serves food',
            subtitle: 'Turn on to take food orders at all',
            value: settings.servesFood,
            onChanged: (v) => vm.update(servesFood: v),
          ),
        ),
        const SizedBox(height: AppTheme.s12),
        Padding(
          padding: const EdgeInsets.only(
            left: AppTheme.s4,
            bottom: AppTheme.s8,
          ),
          child: Text(
            'ORDER CHANNELS',
            style: TextStyle(
              color: AppTheme.muted,
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
            ),
          ),
        ),
        NeuCard(
          padding: const EdgeInsets.all(AppTheme.s12),
          child: Column(
            children: [
              _Toggle(
                icon: Icons.bed_rounded,
                title: 'Take orders from rooms',
                subtitle: settings.hasRooms
                    ? null
                    : 'This property has no rooms',
                value: settings.foodRoomService,
                onChanged: (settings.servesFood && settings.hasRooms)
                    ? (v) => vm.update(foodRoomService: v)
                    : null,
                dimmed: !settings.servesFood,
              ),
              const Divider(height: 20.0, color: AppTheme.border),
              _Toggle(
                icon: Icons.table_bar_rounded,
                title: 'Take orders from dining tables',
                value: settings.foodTableService,
                onChanged: settings.servesFood
                    ? (v) => vm.update(foodTableService: v)
                    : null,
                dimmed: !settings.servesFood,
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTheme.s12),
        _InfoDisclosure(
          expanded: _showInfo,
          onToggle: () => setState(() => _showInfo = !_showInfo),
        ),
        const SizedBox(height: 20.0),
        Row(
          children: [
            if (state.saved)
              const Padding(
                padding: EdgeInsets.only(right: AppTheme.s12),
                child: Icon(
                  Icons.check_circle_rounded,
                  color: AppTheme.vacant,
                  size: 20,
                ),
              ),
            Expanded(
              child: NeuButton(
                primary: true,
                expand: true,
                onPressed: state.saving ? null : () => _save(vm),
                child: state.saving
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        mainAxisSize: MainAxisSize.min,
                        children: const [
                          Icon(
                            Icons.check_rounded,
                            size: 17,
                            color: Colors.white,
                          ),
                          SizedBox(width: 6),
                          Text('Save settings'),
                        ],
                      ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _save(FoodSettingsViewModel vm) async {
    final saved = await vm.save();
    // The bottom bar's own "food" and "menu" tabs are gated on Me.lodge's
    // capability flags — a servesFood flip has to reach that copy too, or the
    // tab strip would keep showing whatever the login started the session
    // with until the next full /me reload.
    if (saved != null) {
      await ref.read(authViewModelProvider.notifier).loadMe();
    }
  }
}

class _Toggle extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool>? onChanged;

  /// Greys out the row's icon badge when its parent switch ("serves food")
  /// is off — the row is still legible, just visibly dependent.
  final bool dimmed;

  const _Toggle({
    required this.icon,
    required this.title,
    this.subtitle,
    required this.value,
    required this.onChanged,
    this.dimmed = false,
  });

  @override
  Widget build(BuildContext context) {
    final tint = dimmed ? AppTheme.muted : AppTheme.accent;
    return Row(
      children: [
        Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: tint.withValues(alpha: 0.10),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 16, color: tint),
        ),
        const SizedBox(width: AppTheme.s12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleSmall),
              if (subtitle != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    subtitle!,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
            ],
          ),
        ),
        Switch(
          value: value,
          onChanged: onChanged,
          activeThumbColor: AppTheme.accent,
        ),
      ],
    );
  }
}

/// A short inline error card — icon plus message on a tinted surface.
class _ErrorBanner extends StatelessWidget {
  final String message;
  const _ErrorBanner(this.message);

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
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: AppTheme.danger, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

/// Collapses the QR/PIN explanation behind a tappable "How this works" row
/// instead of always showing a wall of muted text — keeps the page compact
/// while the detail stays one tap away.
class _InfoDisclosure extends StatelessWidget {
  final bool expanded;
  final VoidCallback onToggle;
  const _InfoDisclosure({required this.expanded, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.accent.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.accent.withValues(alpha: 0.18)),
      ),
      child: Column(
        children: [
          GestureDetector(
            onTap: onToggle,
            behavior: HitTestBehavior.opaque,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.s12,
                vertical: 10,
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.info_outline_rounded,
                    size: 16,
                    color: AppTheme.accent,
                  ),
                  const SizedBox(width: AppTheme.s8),
                  const Expanded(
                    child: Text(
                      'How room PINs and table orders work',
                      style: TextStyle(
                        color: AppTheme.accent,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  AnimatedRotation(
                    duration: const Duration(milliseconds: 150),
                    turns: expanded ? 0.5 : 0,
                    child: const Icon(
                      Icons.expand_more_rounded,
                      size: 18,
                      color: AppTheme.accent,
                    ),
                  ),
                ],
              ),
            ),
          ),
          AnimatedCrossFade(
            duration: const Duration(milliseconds: 150),
            crossFadeState: expanded
                ? CrossFadeState.showFirst
                : CrossFadeState.showSecond,
            firstChild: const Padding(
              padding: EdgeInsets.fromLTRB(
                AppTheme.s12,
                0,
                AppTheme.s12,
                AppTheme.s12,
              ),
              child: Text(
                'One QR code covers the whole property. Guests scan it, pick their items, '
                'then enter their room number and the PIN reception gave them at check-in — '
                'which stops working the moment they check out. Five wrong PINs locks that '
                'room out of ordering for fifteen minutes; reception can unlock it from the '
                'booking. Table orders have no PIN — they wait in the queue until the kitchen '
                'accepts them, so a prank order costs a tap, not a dish.',
                style: TextStyle(
                  color: AppTheme.text,
                  fontSize: 12,
                  height: 1.45,
                ),
              ),
            ),
            secondChild: const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}
