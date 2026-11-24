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

  /// One label style for all three columns, so their boxes start on one line
  /// (the type label used a smaller size than NeuField's, which pushed the
  /// ID number box a couple of pixels lower).
  Widget _label(BuildContext context, String text, {bool star = false}) =>
      Text.rich(
        TextSpan(
          text: text,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: AppTheme.heading,
            fontWeight: FontWeight.w700,
            fontSize: RoomyForm.on(context) ? 13.5 : null,
          ),
          children: star
              ? const [
                  TextSpan(
                    text: ' *',
                    style: TextStyle(color: AppTheme.danger, fontWeight: FontWeight.w700),
                  ),
                ]
              : null,
        ),
      );

  static const _docWidth = 150.0;

  Widget _typePart(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
        _label(context, 'ID proof', star: required),
        SizedBox(height: RoomyForm.on(context) ? 6 : AppTheme.s4),
        SizedBox(
          height: RoomyForm.height(context, 40),
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
                      style: TextStyle(color: AppTheme.muted, fontSize: RoomyForm.fs(context, 14)),
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
                          style: TextStyle(
                            color: AppTheme.heading,
                            fontSize: RoomyForm.fs(context, 14),
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
    ],
  );

  Widget _numberPart(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
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
    ],
  );

  Widget _docPart(BuildContext context, {bool wide = false}) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
            _label(context, 'Document photo (optional)'),
            SizedBox(height: RoomyForm.on(context) ? 6 : AppTheme.s4),
            if (file != null)
              PhotoThumb(
                imageProvider: FileImage(File(file!.path)),
                onRemove: () => onFile!(null),
              )
            else if (wide)
              // A button the height of the fields beside it, not a 72px tile.
              GestureDetector(
                onTap: () async {
                  final picked = await pickIdProofPhoto(context);
                  if (picked != null) onFile!(picked);
                },
                child: Container(
                  height: RoomyForm.height(context, 40),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(AppTheme.rSmall),
                    border: Border.all(color: AppTheme.accent.withValues(alpha: 0.55)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.add_a_photo_outlined, color: AppTheme.accent, size: 18),
                      const SizedBox(width: AppTheme.s8),
                      Text(
                        'Add photo',
                        style: TextStyle(
                          color: AppTheme.accent,
                          fontWeight: FontWeight.w700,
                          fontSize: RoomyForm.fs(context, 13),
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else
              AddPhotoTile(
                onTap: () async {
                  final picked = await pickIdProofPhoto(context);
                  if (picked != null) onFile!(picked);
                },
              ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // With the width for it, the three sit on one row — type, number and
        // the document photo — so a guest's ID takes one line of the form
        // instead of a stack of them.
        if (constraints.maxWidth >= 560) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _typePart(context)),
              const SizedBox(width: AppTheme.s12),
              // Number and photo keep their slots before a type is picked, so
              // the dropdown doesn't change width the moment one is chosen.
              Expanded(
                child: type != null ? _numberPart(context) : const SizedBox(),
              ),
              if (onFile != null) ...[
                const SizedBox(width: AppTheme.s12),
                SizedBox(
                  width: _docWidth,
                  child: type != null ? _docPart(context, wide: true) : null,
                ),
              ],
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _typePart(context),
            if (type != null) ...[
              const SizedBox(height: AppTheme.s4),
              _numberPart(context),
              if (onFile != null) ...[
                const SizedBox(height: AppTheme.s4),
                _docPart(context),
              ],
            ],
          ],
        );
      },
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
