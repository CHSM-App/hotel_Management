import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/reports_viewmodel.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'gst_report_panel.dart';
import 'occupancy_report_panel.dart';
import 'bookings_report_panel.dart';

/// Reports: the same three the web dashboard's Reports tab offers — Bookings,
/// Occupancy, GST summary — over one shared date range. See
/// frontend/src/pages/lodge/ReportsPanel.jsx for the page this mirrors.
class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  String _tab = 'bookings';

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(reportsViewModelProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s16,
            AppTheme.s8,
            AppTheme.s16,
            AppTheme.s8,
          ),
          child: Column(
            children: [
              _RangePicker(state: state),
              const SizedBox(height: AppTheme.s12),
              _SubTabs(selected: _tab, onSelect: (t) => setState(() => _tab = t)),
            ],
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => ref.read(reportsViewModelProvider.notifier).refresh(),
            color: AppTheme.accent,
            child: !state.validRange
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: const [
                      NeuNotice(
                        icon: Icons.date_range_rounded,
                        message: 'Choose a valid date range.',
                      ),
                    ],
                  )
                : switch (_tab) {
                    'occupancy' => const OccupancyReportPanel(),
                    'gst' => const GstReportPanel(),
                    _ => const BookingsReportPanel(),
                  },
          ),
        ),
      ],
    );
  }
}

class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  static const _tabs = {
    'bookings': 'Bookings',
    'occupancy': 'Occupancy',
    'gst': 'GST summary',
  };

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final entry in _tabs.entries) ...[
          Expanded(
            child: GestureDetector(
              onTap: () => onSelect(entry.key),
              child: entry.key == selected
                  ? NeuPressed(
                      radius: AppTheme.rMedium,
                      padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                      child: Center(
                        child: Text(
                          entry.value,
                          style: const TextStyle(
                            color: AppTheme.accent,
                            fontWeight: FontWeight.w500,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    )
                  : NeuCard(
                      radius: AppTheme.rMedium,
                      shadow: AppTheme.subtle,
                      padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                      child: Center(
                        child: Text(
                          entry.value,
                          style: const TextStyle(color: AppTheme.text, fontSize: 13),
                        ),
                      ),
                    ),
            ),
          ),
          if (entry.key != _tabs.keys.last) const SizedBox(width: AppTheme.s8),
        ],
      ],
    );
  }
}

/// From/To date fields plus a month shortcut, the same three controls the
/// web filter bar offers.
class _RangePicker extends ConsumerWidget {
  final ReportsState state;

  const _RangePicker({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vm = ref.read(reportsViewModelProvider.notifier);

    return NeuCard(
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Row(
        children: [
          Expanded(
            child: _DateField(
              label: 'From',
              value: state.fromDate,
              onPick: (picked) => vm.setRange(picked, state.toDate),
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: _DateField(
              label: 'To',
              value: state.toDate,
              minDate: state.fromDate,
              onPick: (picked) => vm.setRange(state.fromDate, picked),
            ),
          ),
        ],
      ),
    );
  }
}

class _DateField extends StatelessWidget {
  final String label;
  final String value;
  final String? minDate;
  final ValueChanged<String> onPick;

  const _DateField({
    required this.label,
    required this.value,
    required this.onPick,
    this.minDate,
  });

  @override
  Widget build(BuildContext context) {
    final parsed = DateTime.tryParse(value);
    return GestureDetector(
      onTap: () async {
        final now = DateTime.now();
        final min = minDate != null ? DateTime.tryParse(minDate!) : null;
        final picked = await showDatePicker(
          context: context,
          initialDate: parsed ?? now,
          firstDate: min ?? DateTime(now.year - 5),
          lastDate: DateTime(now.year + 1),
        );
        if (picked == null) return;
        final iso =
            '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
        onPick(iso);
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
          const SizedBox(height: 2),
          NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 10),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.event_rounded, size: 14, color: AppTheme.muted),
                const SizedBox(width: AppTheme.s8),
                Text(
                  parsed == null
                      ? value
                      : '${parsed.day} ${_monthShort(parsed.month)} ${parsed.year}',
                  style: const TextStyle(color: AppTheme.heading, fontSize: 13),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _monthShort(int month) => const [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][month - 1];
}
