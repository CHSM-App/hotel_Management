import 'package:flutter/material.dart';

import '../theme.dart';
import 'service_usage_panel.dart';
import 'services_catalogue_panel.dart';

/// Other services — mirrors ServicesPanel.jsx's shell: Service use and
/// Services & prices, the same two views the web switches between.
class ServicesScreen extends StatefulWidget {
  const ServicesScreen({super.key});

  @override
  State<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends State<ServicesScreen> {
  String _view = 'usage';

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s8),
          child: _SubTabs(selected: _view, onSelect: (v) => setState(() => _view = v)),
        ),
        Expanded(child: _view == 'catalogue' ? const ServicesCataloguePanel() : const ServiceUsagePanel()),
      ],
    );
  }
}

/// Same sliding-pill segmented control the Income / Expenses / Assets /
/// Rooms & Rates / Housekeeping / Laundry screens use — one connected
/// control with a moving highlight, rather than two separate pills.
class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const double _height = 44;
  static const _tabs = ['usage', 'catalogue'];
  static const _labels = {'usage': 'Service use', 'catalogue': 'Services & prices'};

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
