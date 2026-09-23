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
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(foodSettingsViewModelProvider.notifier).load());
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
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
      children: [
        NeuCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (state.error != null) ...[
                Text(state.error!, style: const TextStyle(color: AppTheme.danger, fontSize: 13)),
                const SizedBox(height: AppTheme.s12),
              ],
              _Toggle(
                title: 'This property serves food',
                value: settings.servesFood,
                onChanged: (v) => vm.update(servesFood: v),
              ),
              const Divider(height: AppTheme.s24, color: AppTheme.border),
              _Toggle(
                title: 'Take orders from rooms',
                subtitle: settings.hasRooms ? null : 'This property has no rooms',
                value: settings.foodRoomService,
                onChanged: (settings.servesFood && settings.hasRooms)
                    ? (v) => vm.update(foodRoomService: v)
                    : null,
              ),
              const SizedBox(height: AppTheme.s12),
              _Toggle(
                title: 'Take orders from dining tables',
                value: settings.foodTableService,
                onChanged: settings.servesFood ? (v) => vm.update(foodTableService: v) : null,
              ),
              const SizedBox(height: AppTheme.s16),
              const Text(
                'One QR code covers the whole property. Guests scan it, pick their items, '
                'then enter their room number and the PIN reception gave them at check-in — '
                'which stops working the moment they check out. Five wrong PINs locks that '
                'room out of ordering for fifteen minutes; reception can unlock it from the '
                'booking. Table orders have no PIN — they wait in the queue until the kitchen '
                'accepts them, so a prank order costs a tap, not a dish.',
                style: TextStyle(color: AppTheme.muted, fontSize: 12.5, height: 1.4),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppTheme.s16),
        Row(
          children: [
            if (state.saved)
              const Padding(
                padding: EdgeInsets.only(right: AppTheme.s12),
                child: Text('Saved', style: TextStyle(color: AppTheme.vacant, fontWeight: FontWeight.w600)),
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
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Save settings'),
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
  final String title;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool>? onChanged;

  const _Toggle({required this.title, this.subtitle, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w500, fontSize: 14),
              ),
              if (subtitle != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(subtitle!, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
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
