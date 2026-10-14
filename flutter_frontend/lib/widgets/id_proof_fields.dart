import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../domain/models/draft.dart';
import '../screens/rooms/room_form_pieces.dart';
import '../screens/theme.dart';
import 'neu.dart';
import 'photo_source_sheet.dart';

/// Lets the desk take an ID proof photo with the camera or pull one from the
/// gallery — the same either-or the web form gets from its file input's own
/// camera affordance, offered explicitly here since a phone has both and no
/// single tap picks between them.
Future<XFile?> pickIdProofPhoto(BuildContext context) async {
  final source = await showPhotoSourceSheet(
    context,
    title: 'Upload ID proof',
    subtitle: 'Take a photo or pick one from your gallery',
  );
  if (source == null) return null;
  return ImagePicker().pickImage(
    source: source,
    imageQuality: 85,
    maxWidth: 1600,
  );
}

/// One glyph per [kIdProofTypes] entry — purely decorative, so a type with
/// no obvious icon (anything added later, or "Other") just falls back to a
/// generic card glyph rather than the map needing an entry for it.
IconData _idProofIcon(String key) {
  switch (key) {
    case 'AADHAAR':
      return Icons.fingerprint;
    case 'PAN':
      return Icons.badge_outlined;
    case 'PASSPORT':
      return Icons.menu_book_outlined;
    case 'DRIVING_LICENSE':
      return Icons.directions_car_filled_outlined;
    case 'VOTER_ID':
      return Icons.how_to_vote_outlined;
    default:
      return Icons.credit_card_outlined;
  }
}

/// The ID proof type/number/photo trio, used both for the primary guest on
/// the booking form and for every additional guest row — here and at
/// check-in alike.
class IdProofFields extends StatelessWidget {
  final String? type;
  final TextEditingController number;
  final ValueChanged<String?> onType;

  /// Only the additional guests need this: their number lives on a draft
  /// object rather than being read off a controller at submit time.
  final ValueChanged<String>? onNumber;

  /// True on a walk-in, where the guest is at the desk and the ID is taken now.
  final bool required;

  /// Shown under the dropdown once a submit was tried and no type was
  /// chosen — the web form marks the type itself required (not the number:
  /// either the number or a document is enough), so this is the one field
  /// in the pair that carries a message.
  final String? errorText;

  /// Shown under the ID number box itself, once a submit was tried and a
  /// walk-in was left without one — the same place every other required
  /// field's message lands, rather than a snackbar the desk has to connect
  /// back to the box themselves.
  final String? numberErrorText;

  /// A photo of the document, taken or picked this session. Either this or
  /// [number] is enough — the same "one is enough, both is better" rule the
  /// web form's own pair of fields carries.
  final XFile? file;
  final ValueChanged<XFile?>? onFile;

  const IdProofFields({
    super.key,
    required this.type,
    required this.number,
    required this.onType,
    this.onNumber,
    this.required = false,
    this.errorText,
    this.numberErrorText,
    this.file,
    this.onFile,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        required
            ? const RequiredLabel('ID proof')
            : Text('ID proof', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: AppTheme.s4),
        SizedBox(
          height: 40,
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String?>(
                value: type,
                isExpanded: true,
                isDense: true,
                borderRadius: BorderRadius.circular(AppTheme.rMedium),
                dropdownColor: AppTheme.card,
                elevation: 3,
                itemHeight: 48,
                icon: const Icon(Icons.keyboard_arrow_down_rounded, color: AppTheme.muted),
                hint: Row(
                  children: [
                    const Icon(Icons.badge_outlined, size: 18, color: AppTheme.muted),
                    const SizedBox(width: AppTheme.s8),
                    Text(
                      required ? 'Choose one' : 'Not recorded',
                      style: const TextStyle(color: AppTheme.muted, fontSize: 14),
                    ),
                  ],
                ),
                selectedItemBuilder: (context) => [
                  if (!required)
                    const Row(
                      children: [
                        Icon(Icons.badge_outlined, size: 18, color: AppTheme.muted),
                        SizedBox(width: AppTheme.s8),
                        Text(
                          'Not recorded',
                          style: TextStyle(color: AppTheme.muted, fontSize: 14),
                        ),
                      ],
                    ),
                  for (final e in kIdProofTypes.entries)
                    Row(
                      children: [
                        Icon(_idProofIcon(e.key), size: 18, color: AppTheme.accent),
                        const SizedBox(width: AppTheme.s8),
                        Text(
                          e.value,
                          style: const TextStyle(
                            color: AppTheme.heading,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                ],
                items: [
                  // "Not recorded" is not on offer where an ID is required —
                  // a walk-in has to carry one.
                  if (!required)
                    const DropdownMenuItem<String?>(
                      child: Text('Not recorded', style: TextStyle(color: AppTheme.muted)),
                    ),
                  for (final e in kIdProofTypes.entries)
                    DropdownMenuItem<String?>(
                      value: e.key,
                      child: _IdProofMenuRow(
                        icon: _idProofIcon(e.key),
                        label: e.value,
                        selected: e.key == type,
                      ),
                    ),
                ],
                onChanged: onType,
              ),
            ),
          ),
        ),
        if (errorText != null) ...[
          const SizedBox(height: AppTheme.s4),
          Text(errorText!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
        ],
        if (type != null) ...[
          const SizedBox(height: AppTheme.s4),
          NeuField(
            controller: number,
            label: 'ID number',
            required: required,
            errorText: numberErrorText,
            maxLength: 40,
            onChanged: onNumber,
            dense: true,
          ),
          if (!required && numberErrorText == null) ...[
            const SizedBox(height: AppTheme.s4),
            Text('Not required', style: Theme.of(context).textTheme.bodySmall),
          ],
          if (onFile != null) ...[
            const SizedBox(height: AppTheme.s4),
            Text('Document photo (optional)', style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: AppTheme.s4),
            if (file != null)
              PhotoThumb(
                imageProvider: FileImage(File(file!.path)),
                onRemove: () => onFile!(null),
              )
            else
              AddPhotoTile(
                onTap: () async {
                  final picked = await pickIdProofPhoto(context);
                  if (picked != null) onFile!(picked);
                },
              ),
          ],
        ],
      ],
    );
  }
}

/// A menu row for the ID proof dropdown: an icon badge in a tinted circle,
/// the label, and a trailing check on whichever type is already picked — so
/// the open menu reads at a glance instead of as a plain text list.
class _IdProofMenuRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;

  const _IdProofMenuRow({
    required this.icon,
    required this.label,
    required this.selected,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: selected ? AppTheme.accent : AppTheme.accent.withValues(alpha: 0.1),
            shape: BoxShape.circle,
          ),
          child: Icon(
            icon,
            size: 16,
            color: selected ? Colors.white : AppTheme.accent,
          ),
        ),
        const SizedBox(width: AppTheme.s12),
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              color: selected ? AppTheme.heading : AppTheme.text,
              fontSize: 14,
              fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
            ),
          ),
        ),
        if (selected)
          const Icon(Icons.check_rounded, size: 18, color: AppTheme.accent),
      ],
    );
  }
}
