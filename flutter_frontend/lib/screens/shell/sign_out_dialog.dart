import 'package:flutter/material.dart';

import '../theme.dart';

/// The "Sign out?" confirmation shown from both the sidebar rail and the
/// profile screen's own menu. Pulled into one place so the two call sites
/// can't drift from each other the way the old inline [AlertDialog]s had.
///
/// Returns `true` if the user confirmed, `false`/`null` if they backed out.
Future<bool?> showSignOutDialog(BuildContext context) {
  return showDialog<bool>(
    context: context,
    builder: (context) => const _SignOutDialog(),
  );
}

class _SignOutDialog extends StatelessWidget {
  const _SignOutDialog();

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppTheme.card,
      insetPadding: const EdgeInsets.symmetric(horizontal: 32),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rLarge),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: AppTheme.danger.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.logout_rounded,
                  color: AppTheme.danger,
                  size: 24,
                ),
              ),
              const SizedBox(height: AppTheme.s16),
              const Text(
                'Sign out?',
                style: TextStyle(
                  color: AppTheme.heading,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: AppTheme.s8),
              const Text(
                'You will need your phone or email and password to get back in.',
                style: TextStyle(
                  color: AppTheme.text,
                  fontSize: 14,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: AppTheme.s24),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context, false),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.heading,
                        side: const BorderSide(color: AppTheme.border, width: 1.5),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppTheme.rMedium),
                        ),
                      ),
                      child: const Text(
                        'Stay signed in',
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppTheme.s12),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppTheme.danger,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppTheme.rMedium),
                        ),
                      ),
                      child: const Text(
                        'Sign out',
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
