import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../domain/models/bar.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// yyyy-MM-dd, the shape every /bar range query takes.
String barIso(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// Strip the 91 / 0 prefix off a typed number, same as the web form.
String barCleanPhone(String raw) {
  var d = raw.replaceAll(RegExp(r'\D'), '');
  if (d.length == 12 && d.startsWith('91')) d = d.substring(2);
  if (d.length == 11 && d.startsWith('0')) d = d.substring(1);
  return d;
}

void barSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

Future<bool> barConfirm(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'Confirm',
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
        TextButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(confirmLabel, style: const TextStyle(color: AppTheme.danger)),
        ),
      ],
    ),
  );
  return ok ?? false;
}

class BarChip extends StatelessWidget {
  final String label;
  final Color color;

  const BarChip(this.label, {super.key, this.color = AppTheme.accent});

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(label, style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w700)),
  );
}

/// A typed quantity (1–100) between − and +, not a tap-per-unit counter.
class BarQty extends StatefulWidget {
  final int value;
  final ValueChanged<int> onChanged;
  final int min;

  /// Small round buttons and a slim field — for dense lists of orderable lines.
  final bool compact;

  const BarQty({super.key, required this.value, required this.onChanged, this.min = 0, this.compact = false});

  @override
  State<BarQty> createState() => _BarQtyState();
}

class _BarQtyState extends State<BarQty> {
  late final _c = TextEditingController(text: '${widget.value}');

  @override
  void didUpdateWidget(covariant BarQty old) {
    super.didUpdateWidget(old);
    if (int.tryParse(_c.text) != widget.value) _c.text = '${widget.value}';
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  void _set(int v) => widget.onChanged(v.clamp(widget.min, 100));

  Widget _round(IconData icon, VoidCallback? onTap) => SizedBox(
    width: 30,
    height: 30,
    child: Material(
      color: onTap == null ? AppTheme.bg : AppTheme.sidebarBrandWash,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Icon(icon, size: 18, color: onTap == null ? AppTheme.border : AppTheme.accent),
      ),
    ),
  );

  Widget _compact() => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      _round(Icons.remove_rounded, widget.value > widget.min ? () => _set(widget.value - 1) : null),
      const SizedBox(width: 6),
      SizedBox(
        width: 40,
        height: 32,
        child: TextField(
          controller: _c,
          textAlign: TextAlign.center,
          keyboardType: TextInputType.number,
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: AppTheme.heading),
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(3)],
          decoration: InputDecoration(
            isDense: true,
            filled: true,
            fillColor: AppTheme.card,
            contentPadding: const EdgeInsets.symmetric(vertical: 7),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppTheme.border)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppTheme.border)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: AppTheme.accent, width: 1.5)),
          ),
          onChanged: (t) {
            final v = int.tryParse(t);
            if (v != null) _set(v);
          },
        ),
      ),
      const SizedBox(width: 6),
      _round(Icons.add_rounded, widget.value < 100 ? () => _set(widget.value + 1) : null),
    ],
  );

  @override
  Widget build(BuildContext context) => widget.compact ? _compact() : _full();

  Widget _full() => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      IconButton(
        visualDensity: VisualDensity.compact,
        icon: const Icon(Icons.remove_circle_outline_rounded),
        onPressed: widget.value > widget.min ? () => _set(widget.value - 1) : null,
      ),
      SizedBox(
        width: 44,
        child: TextField(
          controller: _c,
          textAlign: TextAlign.center,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(3)],
          decoration: const InputDecoration(isDense: true, border: OutlineInputBorder()),
          onChanged: (t) {
            final v = int.tryParse(t);
            if (v != null) _set(v);
          },
        ),
      ),
      IconButton(
        visualDensity: VisualDensity.compact,
        icon: const Icon(Icons.add_circle_outline_rounded),
        onPressed: widget.value < 100 ? () => _set(widget.value + 1) : null,
      ),
    ],
  );
}

/// Pick a checked-in room for "Add to room bill".
Future<BarGuest?> pickBarRoom(BuildContext context, List<BarGuest> guests) {
  return showModalBottomSheet<BarGuest>(
    context: context,
    isScrollControlled: true,
    builder: (ctx) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
        child: guests.isEmpty
            ? const Padding(padding: EdgeInsets.all(24), child: Text('No guests are checked in.'))
            : ListView(
                shrinkWrap: true,
                children: [
                  const Padding(
                    padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
                    child: Text('Add to which room?', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  ),
                  for (final g in guests)
                    ListTile(
                      leading: const Icon(Icons.bed_rounded),
                      title: Text('Room ${g.roomNumber}'),
                      subtitle: g.guestName.isEmpty ? null : Text(g.guestName),
                      onTap: () => Navigator.pop(ctx, g),
                    ),
                ],
              ),
      ),
    ),
  );
}

/// Asks for the discount to take off an order being added to a room bill (shown
/// under Bar there). Null when dismissed; 0 when skipped.
Future<double?> askBarDiscount(BuildContext context) {
  final c = TextEditingController();
  return showDialog<double>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Discount (optional)'),
      content: TextField(
        controller: c,
        autofocus: true,
        keyboardType: TextInputType.number,
        decoration: const InputDecoration(prefixText: '₹ ', hintText: '0'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
        FilledButton(
          onPressed: () => Navigator.pop(ctx, double.tryParse(c.text.trim()) ?? 0),
          child: const Text('Add to room bill'),
        ),
      ],
    ),
  );
}

/// A rounded section card with a title row, used across the bar screens.
class BarSection extends StatelessWidget {
  final String title;
  final Widget? trailing;
  final Widget child;

  const BarSection({super.key, required this.title, this.trailing, required this.child});

  @override
  Widget build(BuildContext context) => NeuCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, color: AppTheme.heading))),
            if (trailing != null) trailing!,
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        child,
      ],
    ),
  );
}
