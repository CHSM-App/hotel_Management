import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../theme.dart';
import 'guest_laundry_tab.dart';
import 'linen_tab.dart';

/// Laundry — mirrors LaundryPanel.jsx: the hotel's own linen through the
/// wash, and guests' laundry taken in at the desk. Guest laundry bills
/// through Other services, so its tab only shows once that add-on is on too.
class LaundryScreen extends ConsumerStatefulWidget {
  const LaundryScreen({super.key});

  @override
  ConsumerState<LaundryScreen> createState() => _LaundryScreenState();
}

class _LaundryScreenState extends ConsumerState<LaundryScreen> {
  String _tab = 'linen';

  @override
  Widget build(BuildContext context) {
    final guestLaundry = ref.watch(authViewModelProvider).me?.lodge.hasOtherServices ?? false;

    return Column(
      children: [
        if (guestLaundry)
          Padding(
            padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s8),
            child: _SubTabs(selected: _tab, onSelect: (t) => setState(() => _tab = t)),
          ),
        Expanded(
          child: _tab == 'laundry' && guestLaundry ? const GuestLaundryTab() : const LinenTab(),
        ),
      ],
    );
  }
}

/// Same sliding-pill segmented control the Income / Expenses / Assets /
/// Rooms & Rates / Housekeeping screens use — one connected control with a
/// moving highlight, rather than two separate pills.
class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const double _height = 44;
  static const _tabs = ['linen', 'laundry'];
  static const _labels = {'linen': 'Hotel linen', 'laundry': 'Guest laundry'};

  @override
  Widget build(BuildContext context) {
    final selectedIndex = _tabs.indexOf(selected).clamp(0, _tabs.length - 1);

    Widget segment(String key) {
      final isSelected = key == selected;
      return Expanded(
        child: GestureDetector(
          onTap: () => onSelect(key),
          behavior: HitTestBehavior.opaque,
          child: SizedBox(
            height: _height,
            child: Center(
              child: AnimatedDefaultTextStyle(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeOut,
                style: TextStyle(
                  color: isSelected ? Colors.white : AppTheme.heading,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                  fontSize: 13,
                ),
                child: Text(_labels[key]!),
              ),
            ),
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
      child: Stack(
        children: [
          AnimatedAlign(
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
            alignment: Alignment(-1 + (2 / (_tabs.length - 1)) * selectedIndex, 0),
            child: FractionallySizedBox(
              widthFactor: 1 / _tabs.length,
              child: Container(
                height: _height - 8,
                decoration: BoxDecoration(
                  color: AppTheme.accent,
                  borderRadius: BorderRadius.circular(AppTheme.rMedium - 4),
                ),
              ),
            ),
          ),
          Row(children: [for (final key in _tabs) segment(key)]),
        ],
      ),
    );
  }
}
