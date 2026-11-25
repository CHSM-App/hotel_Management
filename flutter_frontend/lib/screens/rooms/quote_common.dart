import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../widgets/neu.dart';
import '../theme.dart';

/// The kinds a quotation can be for, in the order the selector shows them.
const kQuotationKinds = <(String, String, IconData)>[
  ('ROOM', 'Room', Icons.bed_rounded),
  ('EVENT', 'Event', Icons.celebration_rounded),
  ('FOOD', 'Restaurant', Icons.restaurant_rounded),
  ('BAR', 'Bar', Icons.local_bar_rounded),
];

String quotationKindLabel(String kind) => kQuotationKinds.firstWhere((k) => k.$1 == kind, orElse: () => kQuotationKinds.first).$2;

/// Which kinds a login may quote — mirrors KIND_PERMISSIONS in
/// backend/src/modules/quotations/quotations.service.js.
List<String> quotableKinds(bool Function(String) can) => [
  if (can('rooms.manage') || can('bookings.manage')) 'ROOM',
  if (can('events.manage')) 'EVENT',
  if (can('orders.manage') || can('orders.take')) 'FOOD',
  if (can('bar.manage') || can('bar.take') || can('bar.bill')) 'BAR',
];

String digitsOnly(String s) => s.replaceAll(RegExp(r'\D'), '');

/// Blank is fine; anything typed has to be a 10-digit Indian mobile.
bool phoneInvalid(String s) {
  final d = digitsOnly(s);
  return d.isNotEmpty && !RegExp(r'^[6-9]\d{9}$').hasMatch(d);
}

/// A titled card for one block of a quotation form: a round icon badge, a
/// title with an optional hint, then the block's fields.
class QuoteSection extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? hint;
  final Widget? trailing;
  final List<Widget> children;

  const QuoteSection({super.key, required this.icon, required this.title, this.hint, this.trailing, required this.children});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      radius: AppTheme.rLarge,
      padding: const EdgeInsets.all(AppTheme.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.12), shape: BoxShape.circle),
                child: Icon(icon, size: 16, color: AppTheme.accent),
              ),
              const SizedBox(width: AppTheme.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: AppTheme.heading)),
                    if (hint != null) Text(hint!, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
                  ],
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: AppTheme.s16),
          ...children,
        ],
      ),
    );
  }
}

/// Fields side by side when there is room, stacked on a phone.
class QuoteRow extends StatelessWidget {
  final List<Widget> children;

  const QuoteRow(this.children, {super.key});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, c) {
        if (c.maxWidth < 520) {
          return Column(
            children: [
              for (var i = 0; i < children.length; i++) ...[
                if (i > 0) const SizedBox(height: AppTheme.s12),
                children[i],
              ],
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < children.length; i++) ...[
              if (i > 0) const SizedBox(width: AppTheme.s12),
              Expanded(child: children[i]),
            ],
          ],
        );
      },
    );
  }
}

/// A tappable value in the same box as a [NeuField] — for dates, times and
/// the venue choice — with its label above, like every other field.
class QuotePickField extends StatelessWidget {
  final String label;
  final String? value;
  final String placeholder;
  final IconData icon;
  /// Gets the field's own context, so a date picker can open right under it.
  final void Function(BuildContext anchor) onTap;

  const QuotePickField({super.key, required this.label, required this.value, required this.placeholder, required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.heading, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Builder(builder: (anchor) => InkWell(
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          onTap: () => onTap(anchor),
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 10),
            child: Row(
              children: [
                Icon(icon, size: 18, color: AppTheme.muted),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Text(
                    value ?? placeholder,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: value == null ? AppTheme.muted : AppTheme.heading, fontSize: RoomyForm.fs(context, 14)),
                  ),
                ),
                const Icon(Icons.arrow_drop_down_rounded, color: AppTheme.muted),
              ],
            ),
          ),
        )),
      ],
    );
  }
}

/// "Guest name" + "Mobile" — both optional, as on the room quotation.
class QuoteGuestFields extends StatelessWidget {
  final TextEditingController name;
  final TextEditingController phone;
  final bool showPhoneError;

  const QuoteGuestFields({super.key, required this.name, required this.phone, this.showPhoneError = false});

  @override
  Widget build(BuildContext context) {
    return QuoteRow([
      NeuField(controller: name, label: 'Guest name', hint: 'Optional', forceCapitalizeWords: true, dense: true),
      NeuField(
        controller: phone,
        label: 'Mobile',
        hint: 'Optional · 10 digits',
        keyboardType: TextInputType.phone,
        maxLength: 10,
        dense: true,
        errorText: showPhoneError && phoneInvalid(phone.text) ? 'Enter a valid 10-digit mobile number.' : null,
      ),
    ]);
  }
}

/// The pill "Save quotation" button the three new panels share.
class QuoteSaveButton extends StatelessWidget {
  final bool saving;
  final VoidCallback? onPressed;

  const QuoteSaveButton({super.key, required this.saving, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 44,
      child: FilledButton.icon(
        style: FilledButton.styleFrom(
          backgroundColor: AppTheme.sidebarBrand,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
          elevation: 0,
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
        onPressed: saving ? null : onPressed,
        icon: saving
            ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
            : const Icon(Icons.bookmark_add_rounded, size: 18),
        label: Text(saving ? 'Saving…' : 'Save quotation'),
      ),
    );
  }
}

/// Number-only input formatter for quantity / amount fields.
final kDigitsFormatter = FilteringTextInputFormatter.digitsOnly;

/// The create view's layout: on a wide window the form fills the screen in two
/// scrolling columns — [main] (the inputs) beside [side] (customer, price and
/// the save button); on a phone or a narrow window they stack.
class QuoteTwoColumn extends StatelessWidget {
  final List<Widget> main;
  final List<Widget> side;

  const QuoteTwoColumn({super.key, required this.main, required this.side});

  @override
  Widget build(BuildContext context) {
    final gutter = AppTheme.gutter(context);
    final pad = EdgeInsets.fromLTRB(gutter, AppTheme.s16, gutter, AppTheme.s32);
    return RoomyForm(
      child: LayoutBuilder(
        builder: (context, c) {
          if (c.maxWidth >= 980) {
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(flex: 3, child: ListView(padding: pad.copyWith(right: AppTheme.s12), children: main)),
                Expanded(flex: 2, child: ListView(padding: pad.copyWith(left: AppTheme.s12), children: side)),
              ],
            );
          }
          return Align(
            alignment: Alignment.topCenter,
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: AppTheme.formMaxWidth(context)),
              child: ListView(
                padding: EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s32),
                children: [...main, const SizedBox(height: AppTheme.s12), ...side],
              ),
            ),
          );
        },
      ),
    );
  }
}

/// "Save & send on WhatsApp" — saves the quotation, then sends it, so the desk
/// does not have to open it again from the list. Same footprint as [QuoteSaveButton].
class QuoteWhatsAppButton extends StatelessWidget {
  final bool busy;
  final VoidCallback? onPressed;

  const QuoteWhatsAppButton({super.key, required this.busy, required this.onPressed});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 44,
      child: OutlinedButton.icon(
        style: OutlinedButton.styleFrom(
          foregroundColor: const Color(0xFF128C7E),
          side: const BorderSide(color: Color(0xFF128C7E), width: 1.4),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
        onPressed: busy ? null : onPressed,
        icon: const Icon(Icons.chat_rounded, size: 18),
        label: const Text('Save & send on WhatsApp'),
      ),
    );
  }
}
