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
          height: 34,
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String?>(
                value: type,
                isExpanded: true,
                isDense: true,
                dropdownColor: AppTheme.bg,
                hint: Text(
                  required ? 'Choose one' : 'Not recorded',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 14),
                ),
                items: [
                  // "Not recorded" is not on offer where an ID is required —
                  // a walk-in has to carry one.
                  if (!required)
                    const DropdownMenuItem<String?>(child: Text('Not recorded')),
                  for (final e in kIdProofTypes.entries)
                    DropdownMenuItem<String?>(value: e.key, child: Text(e.value)),
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
