import 'package:flutter/material.dart';

import '../screens/theme.dart';

/// A raised surface — a white card on the grey-50 page.
class NeuCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final double radius;
  final List<BoxShadow> shadow;
  final VoidCallback? onTap;

  const NeuCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppTheme.s16),
    this.margin,
    this.radius = AppTheme.rMedium,
    this.shadow = AppTheme.extruded,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final body = Container(
      padding: padding,
      margin: margin,
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: AppTheme.border),
        boxShadow: shadow,
      ),
      child: child,
    );

    if (onTap == null) return body;
    return GestureDetector(onTap: onTap, child: body);
  }
}

/// A sunken well — inputs and other surfaces that read as "inside" a card.
///
/// The neumorphic version faked an inset shadow with a gradient; flat design
/// has no light source to fake, so this is just the page's own [AppTheme.bg]
/// dropped inside a card, with a hairline border to separate it from the
/// white surface around it.
class NeuPressed extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;

  const NeuPressed({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.symmetric(
      horizontal: AppTheme.s16,
      vertical: AppTheme.s12,
    ),
    this.radius = AppTheme.rSmall,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: AppTheme.border),
      ),
      child: child,
    );
  }
}

/// A button — solid accent when [primary], a light grey fill otherwise.
///
/// Pressed state is a plain opacity dip rather than a shadow inversion — flat
/// surfaces don't have a light source to invert. Held for the duration of the
/// press rather than animated on tap, so a long press stays dimmed.
class NeuButton extends StatefulWidget {
  final Widget child;
  final VoidCallback? onPressed;
  final bool primary;
  final bool expand;
  final EdgeInsetsGeometry padding;

  const NeuButton({
    super.key,
    required this.child,
    required this.onPressed,
    this.primary = false,
    this.expand = false,
    this.padding = const EdgeInsets.symmetric(
      horizontal: AppTheme.s24,
      vertical: AppTheme.s16,
    ),
  });

  @override
  State<NeuButton> createState() => _NeuButtonState();
}

class _NeuButtonState extends State<NeuButton> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    // 44px is the floor for a touch target; the padding above clears it, and
    // this keeps it cleared if a caller passes something tighter.
    final label = DefaultTextStyle(
      style: TextStyle(
        color: widget.primary ? Colors.white : AppTheme.heading,
        fontSize: 15,
        fontWeight: FontWeight.w600,
      ),
      child: Center(child: widget.child),
    );

    return Opacity(
      opacity: enabled ? (_down ? 0.85 : 1) : 0.5,
      child: GestureDetector(
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapUp: enabled ? (_) => setState(() => _down = false) : null,
        onTapCancel: enabled ? () => setState(() => _down = false) : null,
        onTap: widget.onPressed,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOut,
          width: widget.expand ? double.infinity : null,
          constraints: const BoxConstraints(minHeight: 44),
          padding: widget.padding,
          decoration: BoxDecoration(
            color: widget.primary ? AppTheme.accent : AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
            border: widget.primary ? null : Border.all(color: AppTheme.border),
            boxShadow: widget.primary ? AppTheme.subtle : null,
          ),
          child: label,
        ),
      ),
    );
  }
}

/// A text field sunk into the surface.
class NeuField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String? hint;
  final bool obscure;
  final TextInputType? keyboardType;
  final int? maxLength;
  final String? errorText;
  final ValueChanged<String>? onChanged;
  final bool readOnly;
  final VoidCallback? onTap;

  const NeuField({
    super.key,
    required this.controller,
    required this.label,
    this.hint,
    this.obscure = false,
    this.keyboardType,
    this.maxLength,
    this.errorText,
    this.onChanged,
    this.readOnly = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: AppTheme.s8),
        NeuPressed(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16),
          child: TextField(
            controller: controller,
            obscureText: obscure,
            keyboardType: keyboardType,
            maxLength: maxLength,
            readOnly: readOnly,
            onTap: onTap,
            onChanged: onChanged,
            style: const TextStyle(color: AppTheme.heading, fontSize: 15),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: const TextStyle(color: AppTheme.muted),
              border: InputBorder.none,
              counterText: '',
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),
        ),
        if (errorText != null) ...[
          const SizedBox(height: AppTheme.s4),
          Text(
            errorText!,
            style: const TextStyle(color: AppTheme.danger, fontSize: 12),
          ),
        ],
      ],
    );
  }
}

/// A short message on the surface — empty states, errors, "nothing here yet".
class NeuNotice extends StatelessWidget {
  final String message;
  final IconData icon;
  final Widget? action;

  const NeuNotice({
    super.key,
    required this.message,
    this.icon = Icons.info_outline,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.s32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: AppTheme.muted, size: 40),
            const SizedBox(height: AppTheme.s16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppTheme.text, fontSize: 14),
            ),
            if (action != null) ...[
              const SizedBox(height: AppTheme.s24),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}
