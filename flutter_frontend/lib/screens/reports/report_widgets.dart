import 'package:flutter/material.dart';

import '../../widgets/neu.dart';
import '../theme.dart';

/// Shared bits across the three report panels — the stat grid, the loading
/// and error states, and the booking-status pill.

class ReportLoading extends StatelessWidget {
  const ReportLoading({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: AppTheme.s48),
      child: Center(child: CircularProgressIndicator()),
    );
  }
}

class ReportError extends StatelessWidget {
  final String message;

  const ReportError({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    return NeuNotice(icon: Icons.cloud_off_rounded, message: message);
  }
}

class StatItem {
  final String label;
  final String value;
  final bool accent;

  const StatItem({required this.label, required this.value, this.accent = false});
}

/// A wrapping grid of stat tiles, the phone equivalent of the web's
/// `.reports-panel__stat-grid`.
class StatGrid extends StatelessWidget {
  final List<StatItem> items;

  const StatGrid({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppTheme.s8,
      runSpacing: AppTheme.s8,
      children: [
        for (final item in items)
          SizedBox(
            width: (MediaQuery.sizeOf(context).width - AppTheme.s16 * 2 - AppTheme.s8) / 2,
            child: NeuCard(
              radius: AppTheme.rMedium,
              shadow: AppTheme.subtle,
              padding: const EdgeInsets.all(AppTheme.s12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.label,
                    style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.value,
                    style: TextStyle(
                      color: item.accent ? AppTheme.accent : AppTheme.heading,
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// The booking-status pill — green for anything live, grey for cancelled,
/// matching the web's `badge--on` / `badge--off`.
class StatusBadge extends StatelessWidget {
  final String status;
  final String label;

  const StatusBadge({super.key, required this.status, required this.label});

  @override
  Widget build(BuildContext context) {
    final off = status == 'CANCELLED';
    final color = off ? AppTheme.muted : AppTheme.vacant;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}
