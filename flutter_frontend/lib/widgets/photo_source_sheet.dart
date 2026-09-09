import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../screens/theme.dart';

/// The camera-vs-gallery choice every photo upload in the app needs — a
/// phone has both and no single tap picks between them, so every call site
/// (an ID proof photo, a room's photos) shows this same sheet rather than
/// each rolling its own [ListTile] pair.
Future<ImageSource?> showPhotoSourceSheet(
  BuildContext context, {
  required String title,
  required String subtitle,
}) {
  return showModalBottomSheet<ImageSource>(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(
          AppTheme.s16,
          0,
          AppTheme.s16,
          AppTheme.s16,
        ),
        padding: const EdgeInsets.fromLTRB(
          AppTheme.s16,
          AppTheme.s12,
          AppTheme.s16,
          AppTheme.s16,
        ),
        decoration: BoxDecoration(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(AppTheme.rLarge),
          boxShadow: AppTheme.elevated,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: AppTheme.border,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: AppTheme.s16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(ctx).textTheme.titleMedium,
            ),
            const SizedBox(height: AppTheme.s4),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: Theme.of(ctx).textTheme.bodySmall,
            ),
            const SizedBox(height: AppTheme.s16),
            _PhotoSourceTile(
              icon: Icons.photo_camera_outlined,
              label: 'Take a photo',
              onTap: () => Navigator.of(ctx).pop(ImageSource.camera),
            ),
            const SizedBox(height: AppTheme.s8),
            _PhotoSourceTile(
              icon: Icons.photo_library_outlined,
              label: 'Choose from gallery',
              onTap: () => Navigator.of(ctx).pop(ImageSource.gallery),
            ),
            const SizedBox(height: AppTheme.s8),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              style: TextButton.styleFrom(
                foregroundColor: AppTheme.muted,
                padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
              ),
              child: const Text('Cancel'),
            ),
          ],
        ),
      ),
    ),
  );
}

/// One tappable row in the photo-source sheet — an icon in a tinted circle,
/// a label, and a chevron, styled like the app's other option rows rather
/// than a bare [ListTile].
class _PhotoSourceTile extends StatelessWidget {
  const _PhotoSourceTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.bg,
      borderRadius: BorderRadius.circular(AppTheme.rMedium),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppTheme.s12,
            vertical: AppTheme.s12,
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppTheme.accent.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: AppTheme.accent, size: 20),
              ),
              const SizedBox(width: AppTheme.s12),
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: AppTheme.heading,
                        fontWeight: FontWeight.w500,
                      ),
                ),
              ),
              const Icon(
                Icons.chevron_right,
                color: AppTheme.muted,
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
