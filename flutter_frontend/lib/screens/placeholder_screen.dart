import 'package:flutter/material.dart';

import '../widgets/neu.dart';
import 'shell/feature.dart';
import 'theme.dart';

/// A section that exists in the bottom bar but has no screen behind it yet.
///
/// Deliberately explicit rather than a blank page or a hidden tab. The tabs are
/// built from what this login may actually reach, so hiding the unbuilt ones
/// would make the bar change shape as sections land, and a desk that learned
/// "Billing is the second tab" would find it moving. Saying so plainly is
/// better than either.
class PlaceholderScreen extends StatelessWidget {
  final Feature feature;

  const PlaceholderScreen({super.key, required this.feature});

  @override
  Widget build(BuildContext context) {
    return NeuNotice(
      icon: feature.icon,
      message: '${feature.title} is not on the phone yet.\n\n'
          'It is on the web front desk, and this section is reserved for it.',
      action: NeuCard(
        radius: AppTheme.rSmall,
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.s16,
          vertical: AppTheme.s12,
        ),
        shadow: AppTheme.subtle,
        child: Text(
          'Needs: ${feature.permission}',
          style: const TextStyle(color: AppTheme.muted, fontSize: 12),
        ),
      ),
    );
  }
}
