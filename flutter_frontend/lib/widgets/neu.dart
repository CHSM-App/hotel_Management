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

/// A compact overflow menu for a card or row's own edit/delete pair — one
/// icon-and-label item each, a rounded surface with a soft shadow, and the
/// destructive item in [AppTheme.danger] — used in place of two bare
/// [IconButton]s wherever a row needs to save the horizontal space.
class NeuRowMenu extends StatelessWidget {
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final double iconSize;

  const NeuRowMenu({
    super.key,
    required this.onEdit,
    required this.onDelete,
    this.iconSize = 18,
  });

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      padding: EdgeInsets.zero,
      splashRadius: 18,
      icon: Icon(Icons.more_vert_rounded, size: iconSize, color: AppTheme.muted),
      elevation: 3,
      color: AppTheme.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        side: const BorderSide(color: AppTheme.border),
      ),
      onSelected: (v) => v == 'edit' ? onEdit() : onDelete(),
      itemBuilder: (context) => [
        PopupMenuItem(
          value: 'edit',
          height: 40,
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.edit_outlined, size: 17, color: AppTheme.heading),
              SizedBox(width: 10),
              Text('Edit', style: TextStyle(color: AppTheme.heading, fontSize: 13.5)),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'delete',
          height: 40,
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.delete_outline_rounded, size: 17, color: AppTheme.danger),
              SizedBox(width: 10),
              Text('Delete', style: TextStyle(color: AppTheme.danger, fontSize: 13.5)),
            ],
          ),
        ),
      ],
    );
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

  /// Draws the accent border used to show a field is the one currently
  /// focused — the cursor's location should always be visible, not just
  /// inferable from where the keyboard is typing.
  final bool focused;

  /// Draws the field itself in [AppTheme.danger] — a small red line under
  /// the field is easy to miss on submit; a red-ringed field is not.
  final bool hasError;

  const NeuPressed({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.symmetric(
      horizontal: AppTheme.s16,
      vertical: AppTheme.s12,
    ),
    this.radius = AppTheme.rSmall,
    this.focused = false,
    this.hasError = false,
  });

  @override
  Widget build(BuildContext context) {
    final color = hasError
        ? AppTheme.danger
        : (focused ? AppTheme.accent : AppTheme.border);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      padding: padding,
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(
          color: color,
          width: (focused || hasError) ? 1.6 : 1,
        ),
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

  /// A solid fill to use instead of [AppTheme.accent] when [primary] is
  /// true — lets callers pick a button's own color (e.g. distinguishing
  /// "Advance receipt" from "Check out") without losing the filled,
  /// white-on-color look that [primary] gives.
  final Color? color;

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
    this.color,
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
            color: widget.primary
                ? (widget.color ?? AppTheme.accent)
                : AppTheme.card,
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
class NeuField extends StatefulWidget {
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

  /// Marks the label with the same red asterisk the web form's own `<Req/>`
  /// carries — the field the submit stops on if it is left empty.
  final bool required;

  /// A control sitting inside the field's own well, right-aligned — the
  /// password eye toggle, mirroring the web login's `field__input-wrap`.
  final Widget? suffix;

  /// A second line under the label, right-aligned — the web login's
  /// "Forgot password?" link, sitting in the same row as the label itself.
  final Widget? labelAction;

  /// An external focus node, for callers that need to control or observe
  /// focus themselves (e.g. auto-focusing the first field on open). When
  /// omitted, the field manages its own.
  final FocusNode? focusNode;

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
    this.required = false,
    this.suffix,
    this.labelAction,
    this.focusNode,
  });

  @override
  State<NeuField> createState() => _NeuFieldState();
}

class _NeuFieldState extends State<NeuField> {
  FocusNode? _ownNode;
  bool _focused = false;

  FocusNode get _node => widget.focusNode ?? (_ownNode ??= FocusNode());

  @override
  void initState() {
    super.initState();
    _node.addListener(_onFocusChange);
  }

  void _onFocusChange() {
    if (mounted) setState(() => _focused = _node.hasFocus);
  }

  @override
  void dispose() {
    _node.removeListener(_onFocusChange);
    _ownNode?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text.rich(
                TextSpan(
                  text: widget.label,
                  style: Theme.of(context).textTheme.bodySmall,
                  children: widget.required
                      ? const [
                          TextSpan(
                            text: ' *',
                            style: TextStyle(
                              color: AppTheme.danger,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ]
                      : null,
                ),
              ),
            ),
            if (widget.labelAction != null) widget.labelAction!,
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        NeuPressed(
          focused: _focused,
          hasError: widget.errorText != null,
          padding: EdgeInsets.only(
            left: AppTheme.s16,
            right: widget.suffix == null ? AppTheme.s16 : AppTheme.s4,
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  focusNode: _node,
                  obscureText: widget.obscure,
                  keyboardType: widget.keyboardType,
                  maxLength: widget.maxLength,
                  readOnly: widget.readOnly,
                  onTap: widget.onTap,
                  onChanged: widget.onChanged,
                  style: const TextStyle(color: AppTheme.heading, fontSize: 15),
                  cursorColor: AppTheme.accent,
                  decoration: InputDecoration(
                    hintText: widget.hint,
                    hintStyle: const TextStyle(color: AppTheme.muted),
                    border: InputBorder.none,
                    counterText: '',
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
              ),
              if (widget.suffix != null) widget.suffix!,
            ],
          ),
        ),
        if (widget.errorText != null) ...[
          const SizedBox(height: AppTheme.s4),
          Text(
            widget.errorText!,
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
