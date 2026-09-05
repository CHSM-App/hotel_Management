import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'take_booking_screen.dart';
import 'tape_chart.dart';

/// The register — a tape chart of every room against the chosen nights, the
/// same way the web front desk reads it. Tapping a vacant night opens a
/// booking already set to that room and date; tapping an occupied one opens
/// the stay, with check-in, check-out and cancel right there — so the chart
/// is the whole register, not a picture of one kept somewhere else.
class BookingsScreen extends ConsumerStatefulWidget {
  const BookingsScreen({super.key});

  @override
  ConsumerState<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends ConsumerState<BookingsScreen> {
  @override
  Widget build(BuildContext context) {
    return Stack(
      // Expand rather than the default loose fit, so the chart fills the
      // screen instead of being asked how tall it would like to be.
      fit: StackFit.expand,
      children: [
        const Padding(
          // Only the sides and top — the chart clears the floating New
          // booking button itself, inside its own scrolling content, so the
          // header and legend above it keep their full height instead of
          // being squeezed to make room for a button they don't sit near.
          padding: EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, 0),
          child: TapeChart(),
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: NeuButton(
            primary: true,
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.s24,
              vertical: AppTheme.s16,
            ),
            onPressed: () async {
              final booked = await Navigator.of(context).push<bool>(
                MaterialPageRoute(builder: (_) => const TakeBookingScreen()),
              );
              if (booked == true) {
                ref.read(bookingViewModelProvider.notifier).loadChart();
              }
            },
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: const [
                Icon(Icons.add_rounded, color: Colors.white, size: 18),
                SizedBox(width: AppTheme.s8),
                Text('New booking'),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
