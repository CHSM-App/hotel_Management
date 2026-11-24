import 'package:flutter/material.dart';

import '../screens/theme.dart';

/// The web's modal widths (ActionModal 420, ConfirmDialog 400, form modals
/// wider), named once.
class AppDialogWidth {
  static const double confirm = 400;
  static const double action = 420;
  static const double form = 640;
}

/// A web-style modal on tablet and wider, the existing bottom sheet on a
/// phone. [builder] returns the content only; this supplies the frame, so the
/// same content widget serves both. Esc and tapping outside close it (the
/// dialog route's defaults), and it never grows past 90% of the window height.
Future<T?> showAppDialog<T>(
  BuildContext context, {
  required WidgetBuilder builder,
  double width = AppDialogWidth.action,
  bool barrierDismissible = true,
}) {
  if (AppTheme.isPhone(context)) {
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      isDismissible: barrierDismissible,
      backgroundColor: AppTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.rLarge)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(ctx).bottom),
        child: SingleChildScrollView(child: builder(ctx)),
      ),
    );
  }
  return showDialog<T>(
    context: context,
    barrierDismissible: barrierDismissible,
    builder: (ctx) => Dialog(
      backgroundColor: AppTheme.card,
      surfaceTintColor: Colors.transparent,
      insetPadding: const EdgeInsets.all(AppTheme.s24),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rMedium + 4),
        side: const BorderSide(color: AppTheme.border),
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          minWidth: width,
          maxWidth: width,
          maxHeight: MediaQuery.sizeOf(ctx).height * 0.9,
        ),
        child: SingleChildScrollView(child: builder(ctx)),
      ),
    ),
  );
}
