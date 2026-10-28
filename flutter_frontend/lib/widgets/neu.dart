import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../screens/theme.dart';

/// Rewrites typed/pasted text so the first letter of every word is
/// uppercase, e.g. "john smith" -> "John Smith". Unlike
/// [TextCapitalization], which only hints the on-screen keyboard, this
/// actually enforces the casing of the stored text.
class _CapitalizeWordsFormatter extends TextInputFormatter {
  const _CapitalizeWordsFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final text = newValue.text;
    if (text.isEmpty) return newValue;
    final capitalized = text.replaceAllMapped(
      RegExp(r'(^|[\s\-])([a-z])'),
      (m) => '${m[1]}${m[2]!.toUpperCase()}',
    );
    if (capitalized == text) return newValue;
    return newValue.copyWith(text: capitalized, selection: newValue.selection);
  }
}

/// Rewrites typed/pasted text to all-uppercase, e.g. "abc001" -> "ABC001".
class _UppercaseFormatter extends TextInputFormatter {
  const _UppercaseFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final upper = newValue.text.toUpperCase();
    if (upper == newValue.text) return newValue;
    return newValue.copyWith(text: upper, selection: newValue.selection);
  }
}

/// A raised surface — a white card on the grey-50 page.
class NeuCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final double radius;
  final List<BoxShadow> shadow;
  final VoidCallback? onTap;

  /// The card's own fill — white by default. A card nested inside another
  /// white card (an extra room's box inside the "Stay & room" card, say)
  /// needs a different fill to read as its own surface at all, since
  /// [AppTheme.border] is too light on white to separate two white cards by
  /// itself — the same reason the web form's own equivalent box uses its
  /// `--paper` shade rather than the page's white.
  final Color color;

  /// The border drawn around the card — [AppTheme.border] by default.
  final Color borderColor;

  const NeuCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppTheme.s16),
    this.margin,
    this.radius = AppTheme.rMedium,
    this.shadow = AppTheme.extruded,
    this.onTap,
    this.color = AppTheme.card,
    this.borderColor = AppTheme.border,
  });

  @override
  Widget build(BuildContext context) {
    final body = Container(
      padding: padding,
      margin: margin,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: borderColor),
        boxShadow: shadow,
      ),
      child: child,
    );

    if (onTap == null) return body;
    return GestureDetector(onTap: onTap, child: body);
  }
}

/// Shared surface for the app's choose-one popups (filters, status pickers),
/// matching [NeuActionMenu]'s floating card.
final ShapeBorder neuMenuShape = RoundedRectangleBorder(
  borderRadius: BorderRadius.circular(16),
  side: BorderSide(color: AppTheme.border.withValues(alpha: 0.7)),
);

/// One choice in a choose-one popup: a tinted icon tile, the label, an
/// optional [trailing] (a count, say), and a check when [selected]. The
/// selected row is washed with [color] (default [AppTheme.accent]).
class NeuOptionRow extends StatelessWidget {
  final IconData? icon;
  final String label;
  final bool selected;
  final Color? color;
  final Widget? trailing;

  const NeuOptionRow({
    super.key,
    this.icon,
    required this.label,
    required this.selected,
    this.color,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    final tone = color ?? AppTheme.accent;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: selected ? tone.withValues(alpha: 0.10) : tone.withValues(alpha: 0.03),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          if (icon != null) ...[
            Container(
              width: 26,
              height: 26,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                gradient: selected
                    ? LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [tone.withValues(alpha: 0.95), tone.withValues(alpha: 0.70)],
                      )
                    : null,
                color: selected ? null : tone.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, size: 15, color: selected ? Colors.white : tone),
            ),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: selected ? tone : AppTheme.heading,
                fontSize: 12,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
              ),
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 6), trailing!],
          SizedBox(
            width: 20,
            child: selected ? Icon(Icons.check_circle_rounded, size: 16, color: tone) : null,
          ),
        ],
      ),
    );
  }
}

/// A titled break between groups of [NeuFilterRow]s inside a
/// [NeuFilterPanel] (own group heading in the sheet, small caps in the popup).
class NeuFilterSection extends StatelessWidget {
  final String title;
  const NeuFilterSection(this.title, {super.key});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
    child: Align(
      alignment: Alignment.centerLeft,
      child: Text(
        title,
        style: const TextStyle(
          color: AppTheme.muted,
          fontSize: 10.5,
          fontWeight: FontWeight.w800,
          letterSpacing: 1.2,
        ),
      ),
    ),
  );
}

/// Marks a subtree as living inside a filter bottom sheet, so
/// [NeuFilterPanel] drops its floating-card chrome.
class NeuFilterSheetScope extends InheritedWidget {
  /// Rebuilds the sheet's content — a picked option is reflected at once
  /// while the sheet stays open for the next pick.
  final VoidCallback refresh;

  const NeuFilterSheetScope({super.key, required this.refresh, required super.child});

  static bool of(BuildContext context) =>
      context.getInheritedWidgetOfExactType<NeuFilterSheetScope>() != null;

  static void refreshOf(BuildContext context) =>
      context.getInheritedWidgetOfExactType<NeuFilterSheetScope>()?.refresh();

  @override
  bool updateShouldNotify(NeuFilterSheetScope oldWidget) => false;
}

/// Opens [panel] (built by [builder], handed a close callback) in the app's
/// standard filter bottom sheet: drag handle, "Filters" header with a close
/// button, then the scrollable options.
Future<void> showNeuFilterSheet(
  BuildContext context,
  Widget Function(VoidCallback close) builder, {
  VoidCallback? onReset,

  /// True when the sheet holds more than one group of options, so a pick
  /// leaves it open (and a Done button closes it). A single group closes on
  /// the pick, as there is nothing else to set.
  bool multi = false,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: AppTheme.card,
    showDragHandle: false,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    constraints: const BoxConstraints(maxWidth: 560),
    builder: (sheetContext) {
      void close() => Navigator.of(sheetContext).pop();
      // With several groups, picking an option does not close the sheet — a
      // date and a category can be set in one visit — so the panels get a
      // no-op close; it closes from the X or Done. A single group closes on
      // the pick.
      void keepOpen() {}
      return StatefulBuilder(
        builder: (context, setSheet) => NeuFilterSheetScope(
        refresh: () => setSheet(() {}),
        child: SafeArea(
          top: false,
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(sheetContext).size.height * 0.8,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(height: 8),
                Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppTheme.border,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 6, 4, 0),
                  child: Row(
                    children: [
                      const Icon(Icons.tune_rounded, size: 18, color: AppTheme.accent),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Filters',
                          style: TextStyle(
                            color: AppTheme.heading,
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      if (onReset != null)
                        TextButton(
                          onPressed: () {
                            onReset();
                            setSheet(() {});
                          },
                          style: TextButton.styleFrom(foregroundColor: AppTheme.accent, textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                          child: const Text('Reset'),
                        ),
                      IconButton(
                        onPressed: close,
                        icon: const Icon(Icons.close_rounded, color: AppTheme.muted),
                      ),
                    ],
                  ),
                ),
                Divider(height: 1, color: AppTheme.border.withValues(alpha: 0.7)),
                Flexible(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(4, 10, 4, 14),
                    child: Material(
                      color: Colors.transparent,
                      child: builder(multi ? keepOpen : close),
                    ),
                  ),
                ),
                if (multi)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                  child: SizedBox(
                    width: double.infinity,
                    height: 44,
                    child: FilledButton(
                      onPressed: close,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppTheme.accent,
                        shape: const StadiumBorder(),
                        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
                      ),
                      child: const Text('Done'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        ),
      );
    },
  );
}

/// The floating card that folds open under a screen's filter button: a small
/// caps [title] over a stack of [NeuFilterRow]s.
class NeuFilterPanel extends StatelessWidget {
  final String title;
  final List<Widget> children;

  const NeuFilterPanel({super.key, this.title = 'FILTER BY STATUS', required this.children});

  @override
  Widget build(BuildContext context) {
    // Inside a bottom sheet the panel goes full width and flat — the sheet
    // supplies the card, shadow and header.
    if (NeuFilterSheetScope.of(context)) {
      // Options flow as chips — as many per line as fit — and each
      // NeuFilterSection starts a new titled group.
      Widget heading(String text, double top) => Padding(
        padding: EdgeInsets.fromLTRB(12, top, 12, 6),
        child: Text(
          text,
          style: const TextStyle(
            color: AppTheme.muted,
            fontSize: 11,
            fontWeight: FontWeight.w800,
            letterSpacing: 1.2,
          ),
        ),
      );
      final groups = <Widget>[heading(title, 0)];
      var chips = <Widget>[];
      void flush() {
        if (chips.isEmpty) return;
        groups.add(
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Wrap(spacing: 5, runSpacing: 5, children: chips),
          ),
        );
        chips = <Widget>[];
      }

      for (final c in children) {
        if (c is NeuFilterSection) {
          flush();
          groups.add(heading(c.title, 14));
        } else {
          chips.add(c);
        }
      }
      flush();
      return Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: groups,
      );
    }
    return Container(
      width: 214,
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.border.withValues(alpha: 0.7)),
        boxShadow: const [
          BoxShadow(color: Color(0x40101828), blurRadius: 24, offset: Offset(0, 10)),
        ],
      ),
      padding: const EdgeInsets.only(top: 10, bottom: 6),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                title,
                style: const TextStyle(
                  color: AppTheme.muted,
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.2,
                ),
              ),
            ),
          ),
          ...children,
        ],
      ),
    );
  }
}

/// One tappable row of a [NeuFilterPanel]; shows a count pill when [count]
/// is given.
class NeuFilterRow extends StatelessWidget {
  final String label;
  final int? count;
  final bool on;
  final Color? color;
  final IconData icon;
  final VoidCallback onTap;

  const NeuFilterRow({
    super.key,
    required this.label,
    required this.on,
    required this.icon,
    required this.onTap,
    this.count,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final tint = color ?? AppTheme.accent;
    if (NeuFilterSheetScope.of(context)) {
      return Material(
        color: on ? tint.withValues(alpha: 0.12) : AppTheme.card,
        shape: StadiumBorder(
          side: BorderSide(
            color: on ? tint : AppTheme.border,
            width: on ? 1.4 : 1,
          ),
        ),
        child: InkWell(
          onTap: () {
            onTap();
            NeuFilterSheetScope.refreshOf(context);
          },
          customBorder: const StadiumBorder(),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: on ? tint : AppTheme.heading,
                    fontSize: 12,
                    fontWeight: on ? FontWeight.w800 : FontWeight.w600,
                  ),
                ),
                if (count != null) ...[
                  const SizedBox(width: 6),
                  Text(
                    '$count',
                    style: TextStyle(
                      color: on ? tint : AppTheme.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: NeuOptionRow(
          icon: icon,
          label: label,
          selected: on,
          color: tint,
          trailing: count == null
              ? null
              : Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: on ? tint.withValues(alpha: 0.16) : AppTheme.bg,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$count',
                    style: TextStyle(
                      color: on ? tint : AppTheme.muted,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}

/// One entry in a [NeuActionMenu]. [danger] paints it red.
class NeuMenuAction<T> {
  final T value;
  final IconData icon;
  final String label;
  final bool danger;

  const NeuMenuAction(this.value, this.icon, this.label, {this.danger = false});
}

/// The app's one popup-menu look: a floating rounded card, an "ACTIONS"
/// header, and each action as a tinted row with a gradient icon tile. Every
/// ⋮ menu in the app should be this (or [NeuRowMenu], its edit/delete form)
/// so they all read as the same control.
class NeuActionMenu<T> extends StatelessWidget {
  final List<NeuMenuAction<T>> actions;
  final ValueChanged<T> onSelected;
  final double iconSize;
  final String? header;
  final bool enabled;

  const NeuActionMenu({
    super.key,
    required this.actions,
    required this.onSelected,
    this.iconSize = 18,
    this.header = 'ACTIONS',
    this.enabled = true,
  });

  static Widget _row(NeuMenuAction a) {
    final color = a.danger ? AppTheme.danger : AppTheme.heading;
    final tone = a.danger ? AppTheme.danger : AppTheme.accent;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [tone.withValues(alpha: 0.95), tone.withValues(alpha: 0.70)],
              ),
              borderRadius: BorderRadius.circular(8),
              boxShadow: [
                BoxShadow(
                  color: tone.withValues(alpha: 0.28),
                  blurRadius: 6,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Icon(a.icon, size: 15, color: Colors.white),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              a.label,
              style: TextStyle(
                color: color,
                fontSize: 12,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.1,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const itemPadding = EdgeInsets.symmetric(horizontal: 8, vertical: 1);
    return PopupMenuButton<T>(
      padding: EdgeInsets.zero,
      splashRadius: 18,
      tooltip: 'More actions',
      enabled: enabled,
      offset: const Offset(0, 36),
      icon: Icon(Icons.more_vert_rounded, size: iconSize, color: AppTheme.muted),
      elevation: 12,
      color: AppTheme.card,
      surfaceTintColor: Colors.transparent,
      shadowColor: const Color(0x40101828),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: AppTheme.border.withValues(alpha: 0.7)),
      ),
      constraints: const BoxConstraints(minWidth: 140),
      onSelected: onSelected,
      itemBuilder: (context) => [
        if (header != null)
          PopupMenuItem<T>(
            enabled: false,
            height: 22,
            padding: const EdgeInsets.fromLTRB(14, 2, 14, 0),
            child: Text(
              header!,
              style: const TextStyle(
                color: AppTheme.muted,
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.2,
              ),
            ),
          ),
        for (final a in actions)
          PopupMenuItem<T>(
            value: a.value,
            height: 40,
            padding: itemPadding,
            child: _row(a),
          ),
      ],
    );
  }
}

/// A compact overflow menu for a card or row's own edit/delete pair, used in
/// place of two bare [IconButton]s wherever a row needs to save the
/// horizontal space.
class NeuRowMenu extends StatelessWidget {
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final double iconSize;

  /// An optional middle action between Edit and Delete — a section's
  /// "Hide from guests"/"Show to guests" toggle, say. Omitted entirely
  /// (same two-item menu as always) when null.
  final String? extraLabel;
  final IconData? extraIcon;
  final VoidCallback? onExtra;

  const NeuRowMenu({
    super.key,
    required this.onEdit,
    required this.onDelete,
    this.iconSize = 18,
    this.extraLabel,
    this.extraIcon,
    this.onExtra,
  });

  @override
  Widget build(BuildContext context) {
    return NeuActionMenu<String>(
      iconSize: iconSize,
      actions: [
        const NeuMenuAction('edit', Icons.edit_outlined, 'Edit'),
        if (extraLabel != null && onExtra != null)
          NeuMenuAction('extra', extraIcon ?? Icons.visibility_off_outlined, extraLabel!),
        const NeuMenuAction('delete', Icons.delete_outline_rounded, 'Delete', danger: true),
      ],
      onSelected: (v) {
        if (v == 'edit') {
          onEdit();
        } else if (v == 'extra') {
          onExtra?.call();
        } else {
          onDelete();
        }
      },
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

  /// A tinted pill instead of either the plain white/border look or the
  /// solid [primary] fill — [AppTheme.sidebarBrandWash] behind
  /// [AppTheme.sidebarBrandInk] text, the exact soft badge look as the
  /// sidebar's own selected nav pill (e.g. "Room Chart"). Takes priority
  /// over [primary] when both are set.
  final bool soft;

  /// Overrides the tinted fill [soft] uses in place of
  /// [AppTheme.sidebarBrandWash] — lets a caller give one soft button its
  /// own color (e.g. the draft-amber wash on "Save draft") without losing
  /// the pill look every other soft button shares.
  final Color? softColor;

  /// Overrides the tinted text [soft] uses in place of
  /// [AppTheme.sidebarBrandInk]. Ignored unless [softColor] is also set.
  final Color? softTextColor;

  /// Overrides the border color on the plain white/border look (neither
  /// [primary] nor [soft]) — e.g. an accent-blue outline on "Save draft" to
  /// set it apart from a neighboring plain button like "Close" without
  /// going as heavy as a filled button.
  final Color? outlineColor;

  /// Overrides the label color on the plain white/border look. Ignored
  /// unless [outlineColor] is also set.
  final Color? outlineTextColor;

  /// The floor on the button's own height — 44px (the touch-target minimum)
  /// by default. Callers that already sit inside a tight row of their own
  /// (a repeatable "+ Add …" row under a list, say) can pass a smaller
  /// floor to shrink the button itself, not just its padding.
  final double minHeight;

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
    this.soft = false,
    this.softColor,
    this.softTextColor,
    this.outlineColor,
    this.outlineTextColor,
    this.minHeight = 44,
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
        color: widget.soft
            ? (widget.softTextColor ?? AppTheme.sidebarBrandInk)
            : widget.primary
            ? Colors.white
            : (widget.outlineColor != null
                  ? (widget.outlineTextColor ?? widget.outlineColor!)
                  : AppTheme.heading),
        fontSize: 14,
        fontWeight: FontWeight.w600,
      ),
      // Squeezed too tight (three buttons sharing a narrow row, say), Text
      // would otherwise wrap one letter per line rather than clipping —
      // this keeps it to a single, ellipsized line instead.
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      softWrap: false,
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
          constraints: BoxConstraints(minHeight: widget.minHeight),
          padding: widget.padding,
          decoration: BoxDecoration(
            color: widget.soft
                ? (widget.softColor ?? AppTheme.sidebarBrandWash)
                : widget.primary
                ? (widget.color ?? AppTheme.accent)
                : AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
            border: (widget.primary || widget.soft)
                ? null
                : Border.all(color: widget.outlineColor ?? AppTheme.border),
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

  /// How the field capitalizes what's typed. When omitted, it's inferred
  /// from [obscure]/[keyboardType] so plain text fields capitalize the
  /// first letter by default, while passwords, emails, phone and numeric
  /// fields are left untouched.
  final TextCapitalization? textCapitalization;

  /// When true, forces the first letter of every word typed or pasted
  /// into this field to be uppercase (e.g. name fields), regardless of
  /// the on-screen keyboard's own capitalization hint.
  final bool forceCapitalizeWords;

  /// When true, forces everything typed or pasted into this field to
  /// uppercase (e.g. room numbers like "ABC001").
  final bool forceUppercase;

  /// Shrinks the well's padding and text size for tight inline forms (e.g.
  /// a price-chart row's add/edit fields) where the full-height field used
  /// by onboarding and detail screens would waste space.
  final bool dense;

  /// Colour of the label above the field; defaults to the theme's grey.
  final Color? labelColor;

  /// Weight of the label above the field; defaults to the theme's.
  final FontWeight? labelWeight;

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
    this.textCapitalization,
    this.forceCapitalizeWords = false,
    this.forceUppercase = false,
    this.dense = false,
    this.labelColor,
    this.labelWeight,
  });

  @override
  State<NeuField> createState() => _NeuFieldState();
}

class _NeuFieldState extends State<NeuField> {
  // Phone fields are always digits-only and capped at 10 unless a maxLength is given.
  bool get _isPhone => widget.keyboardType == TextInputType.phone;

  FocusNode? _ownNode;
  bool _focused = false;

  FocusNode get _node => widget.focusNode ?? (_ownNode ??= FocusNode());

  static const _noCapitalizationTypes = [
    'emailAddress',
    'number',
    'phone',
    'url',
    'visiblePassword',
  ];

  TextCapitalization get _defaultCapitalization {
    if (widget.obscure) return TextCapitalization.none;
    final type = widget.keyboardType;
    if (type != null && _noCapitalizationTypes.any((name) => type.toString().contains(name))) {
      return TextCapitalization.none;
    }
    return TextCapitalization.sentences;
  }

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
    final hasLabel = widget.label.isNotEmpty || widget.labelAction != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (hasLabel) ...[
          Row(
            children: [
              Expanded(
                child: Text.rich(
                  TextSpan(
                    text: widget.label,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: widget.labelColor ?? AppTheme.heading,
                          fontWeight: widget.labelWeight ?? FontWeight.w700,
                        ),
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
          SizedBox(height: widget.dense ? AppTheme.s4 : AppTheme.s8),
        ],
        NeuPressed(
          focused: _focused,
          hasError: widget.errorText != null,
          padding: EdgeInsets.only(
            left: widget.dense ? AppTheme.s12 : AppTheme.s16,
            right: widget.suffix == null
                ? (widget.dense ? AppTheme.s12 : AppTheme.s16)
                : AppTheme.s4,
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  focusNode: _node,
                  obscureText: widget.obscure,
                  keyboardType: widget.keyboardType,
                  textCapitalization: widget.textCapitalization ??
                      (widget.forceUppercase || widget.forceCapitalizeWords
                          ? TextCapitalization.words
                          : _defaultCapitalization),
                  inputFormatters: widget.forceUppercase
                      ? const [_UppercaseFormatter()]
                      : widget.forceCapitalizeWords
                          ? const [_CapitalizeWordsFormatter()]
                          : _isPhone
                              ? [FilteringTextInputFormatter.digitsOnly]
                              : null,
                  maxLength: widget.maxLength ?? (_isPhone ? 10 : null),
                  readOnly: widget.readOnly,
                  onTap: widget.onTap,
                  onChanged: widget.onChanged,
                  style: TextStyle(
                    color: AppTheme.heading,
                    fontSize: widget.dense ? 14 : 16,
                  ),
                  cursorColor: AppTheme.accent,
                  decoration: InputDecoration(
                    hintText: widget.hint,
                    hintStyle: TextStyle(
                      color: AppTheme.muted,
                      fontSize: widget.dense ? 13 : null,
                    ),
                    border: InputBorder.none,
                    counterText: '',
                    isDense: true,
                    contentPadding: EdgeInsets.symmetric(
                      vertical: widget.dense ? 6 : 10,
                    ),
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

/// The round filter icon that sits beside a list's search box and view
/// toggle. Tapping it opens [builder]'s panel in the standard filter bottom
/// sheet; [active] lights it while a filter is narrowing the list. [builder]
/// is handed a close callback, and the list is rebuilt when the sheet is
/// dismissed.
class NeuFilterButton extends StatelessWidget {
  final bool active;
  final Widget Function(VoidCallback close) builder;
  final VoidCallback? onClosed;

  /// Clears every filter this list has; shows a Reset action in the sheet.
  final VoidCallback? onReset;

  /// More than one group of options in the panel — see [showNeuFilterSheet].
  final bool multi;

  const NeuFilterButton({super.key, required this.builder, this.active = false, this.onClosed, this.onReset, this.multi = false});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () async {
        await showNeuFilterSheet(context, builder, onReset: onReset, multi: multi);
        onClosed?.call();
      },
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 38,
        height: 38,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: active ? AppTheme.accent : AppTheme.card,
          shape: BoxShape.circle,
          border: Border.all(color: active ? AppTheme.accent : AppTheme.shadowDark, width: 1.3),
          boxShadow: AppTheme.subtle,
        ),
        child: Icon(Icons.filter_alt_rounded, size: 17, color: active ? Colors.white : AppTheme.accent),
      ),
    );
  }
}
