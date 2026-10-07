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

class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const _tabs = {'usage': 'Service use', 'catalogue': 'Services & prices'};

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final entry in _tabs.entries) ...[
          Expanded(child: _Pill(label: entry.value, selected: entry.key == selected, onTap: () => onSelect(entry.key))),
          if (entry.key != _tabs.keys.last) const SizedBox(width: AppTheme.s8),
        ],
      ],
    );
  }
}

class _Pill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _Pill({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        height: 40,
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent : AppTheme.bg,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: selected ? AppTheme.accent : AppTheme.border),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(color: selected ? Colors.white : AppTheme.text, fontWeight: selected ? FontWeight.w600 : FontWeight.w500, fontSize: 13),
        ),
      ),
    );
  }
}
