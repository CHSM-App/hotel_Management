import 'package:flutter/material.dart';

import '../../domain/models/laundry.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// A bounded +/- counter — mirrors the Stepper component in
/// HousekeepingParts.jsx: tap − or + to move by one, never below 0 or past
/// [max].
class CountStepper extends StatelessWidget {
  final int value;
  final ValueChanged<int> onChange;
  final int max;

  const CountStepper({super.key, required this.value, required this.onChange, this.max = 999999});

  @override
  Widget build(BuildContext context) {
    Widget btn(IconData icon, VoidCallback? onTap) => GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 32,
        height: 32,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: onTap == null ? AppTheme.bg : AppTheme.accent.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
        ),
        child: Icon(icon, size: 16, color: onTap == null ? AppTheme.muted : AppTheme.accent),
      ),
    );

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        btn(Icons.remove_rounded, value > 0 ? () => onChange(value - 1) : null),
        SizedBox(
          width: 32,
          child: Text('$value', textAlign: TextAlign.center, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14)),
        ),
        btn(Icons.add_rounded, value < max ? () => onChange(value + 1) : null),
      ],
    );
  }
}

/// Who washes it — hotel linen and guest laundry ask the same way. An
/// outside vendor has a name and may have a price; the lodge's own laundry
/// has neither. Mirrors WasherFields in LaundryPanel.jsx.
class WasherFields extends StatelessWidget {
  final String washer; // 'OWN' | 'VENDOR'
  final ValueChanged<String> onWasherChange;
  final TextEditingController nameController;
  final TextEditingController? phoneController;
  final TextEditingController priceController;
  final String priceLabel;
  final bool needName;
  final bool needPrice;
  final String? nameError;
  final String? phoneError;
  final String? priceError;

  const WasherFields({
    super.key,
    required this.washer,
    required this.onWasherChange,
    required this.nameController,
    this.phoneController,
    required this.priceController,
    required this.priceLabel,
    this.needName = false,
    this.needPrice = false,
    this.nameError,
    this.phoneError,
    this.priceError,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ToggleGroup(
          options: const {'VENDOR': 'Outside vendor', 'OWN': 'Own laundry'},
          selected: washer,
          onSelect: onWasherChange,
        ),
        if (washer == 'VENDOR') ...[
          const SizedBox(height: AppTheme.s12),
          NeuField(controller: nameController, label: 'Vendor name', required: needName, hint: 'e.g. Sai Laundry', errorText: nameError, forceCapitalizeWords: true),
          if (phoneController != null) ...[
            const SizedBox(height: AppTheme.s12),
            NeuField(controller: phoneController!, label: 'Vendor mobile', hint: '10-digit number', keyboardType: TextInputType.phone, errorText: phoneError),
          ],
          const SizedBox(height: AppTheme.s12),
          NeuField(controller: priceController, label: priceLabel, required: needPrice, hint: 'e.g. 450', keyboardType: TextInputType.number, errorText: priceError),
        ],
      ],
    );
  }
}

/// "Towel", "e.g. 450" — what is wrong with the washer fields, per field, or
/// null when nothing is. Mirrors washerErrors in LaundryPanel.jsx.
class WasherValidation {
  final String? name;
  final String? phone;
  final String? price;

  const WasherValidation({this.name, this.phone, this.price});

  bool get hasError => name != null || phone != null || price != null;

  static WasherValidation of({
    required String washer,
    required String name,
    String? phone,
    required String price,
    bool needName = false,
    bool needPrice = false,
  }) {
    if (washer != 'VENDOR') return const WasherValidation();
    String? nameErr;
    String? phoneErr;
    String? priceErr;
    if (needName && name.trim().isEmpty) nameErr = 'Vendor name is required';
    final digits = (phone ?? '').replaceAll(RegExp(r'\D'), '');
    if ((phone ?? '').trim().isNotEmpty && digits.length != 10) phoneErr = 'Enter a 10-digit mobile number';
    final trimmedPrice = price.trim();
    if (trimmedPrice.isEmpty) {
      if (needPrice) priceErr = 'Price is required';
    } else if (num.tryParse(trimmedPrice) == null || num.parse(trimmedPrice) < 0) {
      priceErr = 'Enter the price as a number';
    }
    return WasherValidation(name: nameErr, phone: phoneErr, price: priceErr);
  }
}

/// A 0 steps back so the numbers that need attention are the ones that show
/// — mirrors the `zero` helper in LaundryPanel.jsx's LinenTab.
TextStyle zeroStyle(int n) => TextStyle(
  color: n == 0 ? AppTheme.muted : AppTheme.heading,
  fontWeight: FontWeight.w700,
  fontSize: 15,
);

/// "4 Bedsheet, 2 Towel" — the three biggest and a count of the rest.
/// Mirrors the `breakdown` helper in LaundryPanel.jsx's LinenTab.
String linenBreakdown(List<LinenItem> items, int Function(LinenItem) key) {
  final parts = items.where((i) => key(i) > 0).toList()..sort((a, b) => key(b).compareTo(key(a)));
  if (parts.isEmpty) return '';
  final shown = parts.take(3).map((i) => '${key(i)} ${i.name}').join(', ');
  return parts.length > 3 ? '$shown +${parts.length - 3} more' : shown;
}

/// A compact row-style tile for each of the four linen-board steps (With
/// housekeeping / Dirty / In wash / Clean) — one per row, rather than a
/// grid of boxes.
class LinenCompactCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final Color tone;
  final int total;
  final String detail;
  final String? note;
  final String? action;
  final bool disabled;
  final bool busy;
  final VoidCallback? onAction;

  const LinenCompactCard({
    super.key,
    required this.icon,
    required this.title,
    required this.tone,
    required this.total,
    required this.detail,
    this.note,
    this.action,
    this.disabled = false,
    this.busy = false,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.subtle,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: tone.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
                child: Icon(icon, size: 16, color: tone),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 12.5)),
                    Text(detail, style: const TextStyle(color: AppTheme.muted, fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Text('$total', style: TextStyle(color: total == 0 ? AppTheme.muted : AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 19)),
            ],
          ),
          if (note != null) ...[
            const SizedBox(height: 4),
            Text(note!, style: const TextStyle(color: AppTheme.muted, fontSize: 10.5)),
          ],
          if (action != null) ...[
            const SizedBox(height: AppTheme.s8),
            SizedBox(
              width: double.infinity,
              child: NeuButton(
                primary: true,
                color: tone,
                expand: true,
                onPressed: disabled || busy ? null : onAction,
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Text(action!, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// An icon + label row for a linen item's "⋮" menu — mirrors
/// _AssetMenuRow in assets_list_panel.dart so the menu reads the same way
/// across screens.
class LinenMenuRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool danger;

  const LinenMenuRow({super.key, required this.icon, required this.label, this.danger = false});

  @override
  Widget build(BuildContext context) {
    final color = danger ? AppTheme.danger : AppTheme.heading;
    return Row(
      children: [
        Icon(icon, size: 17, color: danger ? AppTheme.danger : AppTheme.muted),
        const SizedBox(width: AppTheme.s8),
        Text(label, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w600)),
      ],
    );
  }
}

class ErrorBanner extends StatelessWidget {
  final String message;
  const ErrorBanner(this.message, {super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
          const SizedBox(width: AppTheme.s8),
          Expanded(child: Text(message, style: const TextStyle(color: AppTheme.danger, fontSize: 13))),
        ],
      ),
    );
  }
}
