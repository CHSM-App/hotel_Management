import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'qr_codes_panel.dart';

import '../../domain/models/menu.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Menu & QR codes > Tables — mirrors TablesPanel.jsx: single or bulk-range
/// add, a seats chip, and "regenerate QR" behind a warning that every printed
/// copy of the old code stops working.
class TablesPanel extends ConsumerStatefulWidget {
  /// 'BAR' manages the bar's own tables; no QR codes there.
  final String area;
  const TablesPanel({super.key, this.area = 'RESTAURANT'});

  @override
  ConsumerState<TablesPanel> createState() => _TablesPanelState();
}

class _TablesPanelState extends ConsumerState<TablesPanel> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(tablesViewModelProvider(widget.area).notifier).load());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(tablesViewModelProvider(widget.area));

    return Stack(
      fit: StackFit.expand,
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(tablesViewModelProvider(widget.area).notifier).load(),
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, 88),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${state.tables.length} table${state.tables.length == 1 ? '' : 's'}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  TextButton.icon(
                    onPressed: state.tables.any((t) => t.isActive)
                        ? () => downloadQrEntries([
                              for (final t in state.tables.where((t) => t.isActive))
                                QrPrintEntry(title: t.label, subtitle: widget.area == 'BAR' ? 'Bar table' : 'Table', url: tableOrderUrl(t.qrToken ?? ''), centerTop: widget.area == 'BAR' ? 'BAR' : 'RESTAURANT', centerBottom: t.label),
                            ], widget.area == 'BAR' ? 'bar-table-qr-codes' : 'table-qr-codes')
                        : null,
                    icon: const Icon(Icons.download_rounded, size: 18),
                    label: const Text('Download all codes'),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              if (state.isLoading && state.tables.isEmpty)
                const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
              else if (state.error != null && state.tables.isEmpty)
                NeuNotice(icon: Icons.cloud_off_rounded, message: state.error!)
              else if (state.tables.isEmpty)
                NeuNotice(
                  icon: Icons.table_bar_rounded,
                  message: widget.area == 'BAR'
                      ? 'No bar tables yet. Add them here — each gets its own QR code so guests can order drinks and food.'
                      : 'No tables yet. Add them here — each gets its own QR code to print and stick on the table.',
                )
              else
                // A grid, not a single-width list — the same
                // auto-fill-minmax(180px) the web's own table grid uses, so a
                // dozen tables reads as a compact wall of cards rather than a
                // scroll of nearly-empty rows.
                LayoutBuilder(
                  builder: (context, constraints) {
                    final columns = (constraints.maxWidth / 220).floor().clamp(1, 4);
                    final itemWidth = (constraints.maxWidth - AppTheme.s8 * (columns - 1)) / columns;
                    return Wrap(
                      spacing: AppTheme.s8,
                      runSpacing: AppTheme.s8,
                      children: [
                        for (final table in state.tables)
                          SizedBox(width: itemWidth, child: _TableCard(table: table, area: widget.area)),
                      ],
                    );
                  },
                ),
            ],
          ),
        ),
        Positioned(
          right: AppTheme.s16,
          bottom: AppTheme.s16,
          child: FloatingActionButton(
            backgroundColor: AppTheme.accent,
            foregroundColor: Colors.white,
            onPressed: () => _showTableForm(context, ref, widget.area),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _TableCard extends ConsumerWidget {
  final DiningTable table;
  final String area;

  const _TableCard({required this.table, required this.area});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isBar = area == 'BAR';
    final url = tableOrderUrl(table.qrToken ?? '');
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      radius: AppTheme.rMedium,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      table.label,
                      style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 18),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      table.seats != null ? '${table.seats} seat${table.seats == 1 ? '' : 's'}' : 'Seats not set',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              _StatusBadge(
                isActive: table.isActive,
                onTap: () => ref.read(tablesViewModelProvider(area).notifier).setActive(table.id, !table.isActive),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          // A code needs a light quiet zone to scan, so the tile is white in every theme.
          AspectRatio(
            aspectRatio: 1,
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(AppTheme.rMedium),
                border: Border.all(color: AppTheme.border),
              ),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Opacity(
                    opacity: table.isActive ? 1 : 0.12,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        QrImageView(
                          data: url,
                          backgroundColor: Colors.white,
                          padding: EdgeInsets.zero,
                          errorCorrectionLevel: QrErrorCorrectLevel.H,
                        ),
                        // Names the code in its middle; level H survives the cover.
                        Container(
                          constraints: const BoxConstraints(maxWidth: 84),
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            border: Border.all(color: Colors.black, width: 1.2),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(isBar ? 'BAR' : 'RESTAURANT', style: const TextStyle(color: Colors.black, fontSize: 8, fontWeight: FontWeight.w700), maxLines: 1),
                              Text(table.label, style: const TextStyle(color: Colors.black, fontSize: 14, fontWeight: FontWeight.w800), maxLines: 1, overflow: TextOverflow.ellipsis),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (!table.isActive)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(99)),
                      child: const Text('Inactive · code is off', style: TextStyle(color: AppTheme.danger, fontSize: 12, fontWeight: FontWeight.w600)),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Scan to order ${isBar ? 'drinks & food' : 'food'}',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: AppTheme.accent, minimumSize: const Size.fromHeight(44)),
                  onPressed: () => downloadQrEntries(
                    [QrPrintEntry(title: table.label, subtitle: isBar ? 'Bar table' : 'Table', url: url, centerTop: isBar ? 'BAR' : 'RESTAURANT', centerBottom: table.label)],
                    '${isBar ? 'bar-' : ''}table-${table.label.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '-')}',
                  ),
                  icon: const Icon(Icons.download_rounded, size: 18),
                  label: const Text('Download QR'),
                ),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(44)),
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: url));
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Link copied'), backgroundColor: AppTheme.heading),
                      );
                    }
                  },
                  icon: const Icon(Icons.copy_rounded, size: 18),
                  label: const Text('Copy link'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Divider(height: 1, color: AppTheme.border),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              _RoundIconButton(
                icon: Icons.edit_outlined,
                tooltip: 'Edit',
                onTap: () => _showTableForm(context, ref, area, table: table),
              ),
              _RoundIconButton(
                icon: Icons.refresh_rounded,
                tooltip: 'New QR code',
                onTap: () => _confirmRegenerate(context, ref),
              ),
              _RoundIconButton(
                icon: Icons.delete_outline_rounded,
                tooltip: 'Delete',
                color: AppTheme.danger,
                onTap: () => _confirmDelete(context, ref),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _confirmRegenerate(BuildContext context, WidgetRef ref) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text('Issue a new QR code for ${table.label}?', style: const TextStyle(color: AppTheme.heading)),
        content: const Text(
          "Every printed copy of the current code will stop working, so you'll need to print and stick the new one.",
          style: TextStyle(color: AppTheme.text, fontSize: 13),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Issue new code')),
        ],
      ),
    );
    if (sure != true) return;
    await ref.read(tablesViewModelProvider(area).notifier).regenerateQr(table.id);
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text('Delete ${table.label}?', style: const TextStyle(color: AppTheme.heading)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (sure != true || !context.mounted) return;
    final ok = await ref.read(tablesViewModelProvider(area).notifier).delete(table.id);
    if (!ok && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ref.read(tablesViewModelProvider(area)).error ?? 'Could not delete this table.'),
          backgroundColor: AppTheme.heading,
        ),
      );
    }
  }
}

class _StatusBadge extends StatelessWidget {
  final bool isActive;
  final VoidCallback onTap;

  const _StatusBadge({required this.isActive, required this.onTap});

  @override
  Widget build(BuildContext context) {
    // Sits on the gradient band, so "Active" reads as a translucent chip cut
    // into the band rather than a solid color fighting it — the same
    // treatment the web card's badge--on gets. "Inactive" still gets a
    // solid danger-tinted chip, since the band itself has already gone grey
    // by then and a translucent chip would vanish into it.
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: isActive ? Colors.white.withValues(alpha: 0.18) : Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: isActive ? Colors.white.withValues(alpha: 0.5) : AppTheme.danger.withValues(alpha: 0.3)),
        ),
        child: Text(
          isActive ? 'Active' : 'Inactive',
          style: TextStyle(
            color: isActive ? Colors.white : AppTheme.danger,
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

/// A plain circular icon button — edit, new QR code, delete — riding under
/// the hairline the same way the web card's `.table-card__actions` row does,
/// rather than a kebab menu hiding two of the three behind a tap.
class _RoundIconButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final Color? color;
  final VoidCallback onTap;

  const _RoundIconButton({required this.icon, required this.tooltip, required this.onTap, this.color});

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Container(
          width: 28,
          height: 28,
          margin: const EdgeInsets.symmetric(horizontal: 1),
          alignment: Alignment.center,
          decoration: BoxDecoration(color: AppTheme.bg, shape: BoxShape.circle),
          child: Icon(icon, size: 15, color: color ?? AppTheme.muted),
        ),
      ),
    );
  }
}

// ── Add / edit page ──────────────────────────────────────────────────────

Future<void> _showTableForm(BuildContext context, WidgetRef ref, String area, {DiningTable? table}) {
  // A full page rather than a sheet, same as the dish and material forms —
  // this is a real form with its own validation, not a quick pick.
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => _TableFormPage(table: table, area: area)),
  );
}

class _TableFormPage extends ConsumerStatefulWidget {
  final DiningTable? table;
  final String area;
  const _TableFormPage({this.table, required this.area});

  @override
  ConsumerState<_TableFormPage> createState() => _TableFormPageState();
}

class _TableFormPageState extends ConsumerState<_TableFormPage> {
  bool _bulk = false;
  late final _label = TextEditingController(text: widget.table?.label ?? '');
  final _prefix = TextEditingController(text: 'T');
  final _rangeStart = TextEditingController();
  final _rangeEnd = TextEditingController();
  late final _seats = TextEditingController(text: widget.table?.seats?.toString() ?? '');
  String? _error;
  bool _submitAttempted = false;

  bool get _editing => widget.table != null;

  String? get _labelError =>
      (_submitAttempted && (_editing || !_bulk) && _label.text.trim().isEmpty) ? 'Enter a table name.' : null;

  String? get _rangeStartError {
    if (!_submitAttempted || _editing || !_bulk) return null;
    return _rangeStart.text.trim().isEmpty ? 'Enter the start of the range.' : null;
  }

  String? get _rangeEndError {
    if (!_submitAttempted || _editing || !_bulk) return null;
    if (_rangeEnd.text.trim().isEmpty) return 'Enter the end of the range.';
    final from = int.tryParse(_rangeStart.text.trim());
    final to = int.tryParse(_rangeEnd.text.trim());
    if (from != null && to != null && to < from) return 'Must not be before the start.';
    return null;
  }

  @override
  void dispose() {
    _label.dispose();
    _prefix.dispose();
    _rangeStart.dispose();
    _rangeEnd.dispose();
    _seats.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(tablesViewModelProvider(widget.area)).submitting;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          _editing ? 'Edit table' : 'Add tables',
          overflow: TextOverflow.ellipsis,
          maxLines: 1,
        ),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: AppTheme.formMaxWidth(context)),
            child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s16),
          children: [
            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(AppTheme.s12),
                decoration: BoxDecoration(
                  color: AppTheme.danger.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(AppTheme.rSmall),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(child: Text(_error!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.danger))),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s12),
            ],
            NeuCard(
              radius: AppTheme.rLarge,
              shadow: AppTheme.elevated,
              padding: const EdgeInsets.all(AppTheme.s16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SectionLabel(
                    _bulk && !_editing ? 'Table range' : 'Table',
                    number: 1,
                    icon: Icons.table_restaurant_rounded,
                  ),
                  const SizedBox(height: AppTheme.s12),
                  if (!_editing) ...[
                    Align(
                      alignment: Alignment.centerLeft,
                      child: ModeToggle(
                        options: const {'single': 'One table', 'bulk': 'A range'},
                        selected: _bulk ? 'bulk' : 'single',
                        onSelect: (v) => setState(() => _bulk = v == 'bulk'),
                      ),
                    ),
                    const SizedBox(height: AppTheme.s12),
                  ],
                  if (_editing || !_bulk)
                    NeuField(
                      controller: _label,
                      label: 'Table name',
                      hint: 'T1',
                      required: true,
                      errorText: _labelError,
                      onChanged: (_) => setState(() {}),
                      forceCapitalizeWords: true,
                      dense: true,
                    )
                  else ...[
                    NeuField(controller: _prefix, label: 'Name starts with', hint: 'T', dense: true),
                    const SizedBox(height: AppTheme.s12),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: NeuField(
                            controller: _rangeStart,
                            label: 'From',
                            hint: '1',
                            keyboardType: TextInputType.number,
                            required: true,
                            errorText: _rangeStartError,
                            onChanged: (_) => setState(() {}),
                            dense: true,
                          ),
                        ),
                        const SizedBox(width: AppTheme.s12),
                        Expanded(
                          child: NeuField(
                            controller: _rangeEnd,
                            label: 'To',
                            hint: '12',
                            keyboardType: TextInputType.number,
                            required: true,
                            errorText: _rangeEndError,
                            onChanged: (_) => setState(() {}),
                            dense: true,
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SectionDivider(),
                  const SectionLabel('Seats', number: 2, icon: Icons.event_seat_rounded),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _seats,
                    label: 'Seats (optional)',
                    hint: '4',
                    keyboardType: TextInputType.number,
                    dense: true,
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s16),
            Align(
              alignment: Alignment.centerRight,
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerRight,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    NeuButton(
                      onPressed: submitting ? null : () => Navigator.of(context).pop(),
                      child: const Text('Cancel'),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    NeuButton(
                      primary: true,
                      onPressed: submitting ? null : _submit,
                      child: submitting
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : Text(_editing ? 'Save changes' : 'Add tables'),
                    ),
                  ],
                ),
              ),
            ),
          ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    setState(() {
      _error = null;
      _submitAttempted = true;
    });
    final vm = ref.read(tablesViewModelProvider(widget.area).notifier);
    final seats = int.tryParse(_seats.text.trim());

    if (_editing) {
      if (_label.text.trim().isEmpty) return;
      final ok = await vm.saveTable(id: widget.table!.id, label: _label.text.trim(), seats: seats);
      if (!mounted) return;
      if (ok) {
        Navigator.pop(context);
      } else {
        setState(() => _error = ref.read(tablesViewModelProvider(widget.area)).error ?? 'Could not save the table.');
      }
      return;
    }

    if (!_bulk) {
      if (_label.text.trim().isEmpty) return;
      final ok = await vm.saveTable(label: _label.text.trim(), seats: seats);
      if (!mounted) return;
      if (ok) {
        Navigator.pop(context);
      } else {
        setState(() => _error = ref.read(tablesViewModelProvider(widget.area)).error ?? 'Could not save the table.');
      }
      return;
    }

    final from = int.tryParse(_rangeStart.text.trim());
    final to = int.tryParse(_rangeEnd.text.trim());
    if (from == null || to == null || to < from) return;
    final ok = await vm.saveBulk(
      prefix: _prefix.text.trim().isEmpty ? 'T' : _prefix.text.trim(),
      rangeStart: from,
      rangeEnd: to,
      seats: seats,
    );
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(tablesViewModelProvider(widget.area)).error ?? 'Could not save the tables.');
    }
  }
}
