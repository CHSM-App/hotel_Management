import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'laundry_parts.dart';
import 'linen_item_form_screen.dart';
import 'linen_loss_screen.dart';
import 'linen_receive_screen.dart';
import 'linen_send_screen.dart';

/// Hotel linen through the wash — mirrors LaundryPanel.jsx's LinenTab: four
/// steps (With housekeeping / Dirty / In wash / Clean), who's waiting to
/// hand linen over, the stock table, and recent history.
class LinenTab extends ConsumerStatefulWidget {
  const LinenTab({super.key});

  @override
  ConsumerState<LinenTab> createState() => _LinenTabState();
}

class _LinenTabState extends ConsumerState<LinenTab> {
  bool _spreadsheet = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(laundryViewModelProvider.notifier).loadBoard());
  }

  Future<void> _receiveHandover(List<int> movementIds) =>
      ref.read(laundryViewModelProvider.notifier).receiveHandover(movementIds);

  void _hideItem(LinenItem item) {
    final away = item.withHousekeeping + item.dirty + item.inLaundry;
    if (away > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${item.name} still has $away with housekeeping, dirty or in the wash. Receive and wash those first, then hide it.')),
      );
      return;
    }
    showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Hide this item?', style: TextStyle(color: AppTheme.heading)),
        content: Text('Hide ${item.name}? Its history is kept, and you can bring it back from "Add item".', style: const TextStyle(color: AppTheme.text)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Hide', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    ).then((confirmed) {
      if (confirmed == true) ref.read(laundryViewModelProvider.notifier).setLinenItemActive(item.id, false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(laundryViewModelProvider);
    final items = state.activeItems;
    final hidden = state.hiddenItems;
    final groups = state.staffGroups;

    if (state.isLoading && state.board.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(laundryViewModelProvider.notifier).loadBoard(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (state.error != null) ...[
            ErrorBanner(state.error!),
            const SizedBox(height: AppTheme.s12),
          ],
          if (items.isEmpty)
            _EmptyLinenBoard(
              onAddStarter: (name) => showLinenItemFormScreen(context, startingName: name),
              onAdd: () => showLinenItemFormScreen(context),
            )
          else ...[
            Builder(
              builder: (context) {
                final withHousekeeping = LinenCompactCard(
                  icon: Icons.room_service_outlined,
                  title: 'With housekeeping',
                  tone: AppTheme.checkedIn,
                  total: state.totalWithHousekeeping,
                  detail: state.totalWithHousekeeping == 0
                      ? 'Nothing waiting to be received.'
                      : groups.length > 1
                          ? groups.map((g) => '${g.name}: ${g.pieces}').join(' · ')
                          : linenBreakdown(items, (i) => i.withHousekeeping),
                  note: groups.length > 1 ? 'Receive from each person below.' : null,
                  action: groups.length == 1 ? 'Receive from ${groups.first.name}' : null,
                  disabled: groups.isEmpty,
                  busy: state.submitting,
                  onAction: groups.length == 1 ? () => _receiveHandover(groups.first.movementIds) : null,
                );
                final dirty = LinenCompactCard(
                  icon: Icons.local_laundry_service_outlined,
                  title: 'Dirty',
                  tone: AppTheme.danger,
                  total: state.totalDirty,
                  detail: state.totalDirty == 0 ? 'Nothing waiting to be washed.' : linenBreakdown(items, (i) => i.dirty),
                  action: 'Send for washing',
                  disabled: state.totalDirty + state.totalClean == 0,
                  busy: state.submitting,
                  onAction: () => showLinenSendScreen(context),
                );
                final inWash = LinenCompactCard(
                  icon: Icons.autorenew_rounded,
                  title: 'In wash',
                  tone: AppTheme.edit,
                  total: state.totalInLaundry,
                  detail: state.totalInLaundry == 0 ? 'Nothing is in the wash.' : linenBreakdown(items, (i) => i.inLaundry),
                  action: 'Receive washed',
                  disabled: state.atLaundry.isEmpty,
                  busy: state.submitting,
                  onAction: () => showLinenReceiveScreen(context),
                );
                final clean = LinenCompactCard(
                  icon: Icons.task_alt_rounded,
                  title: 'Clean',
                  tone: AppTheme.vacant,
                  total: state.totalClean,
                  detail: state.totalClean == 0 ? 'No clean linen left.' : linenBreakdown(items, (i) => i.clean),
                );

                return Column(
                  children: [
                    IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(child: withHousekeeping),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(child: dirty),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppTheme.s8),
                    IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(child: inWash),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(child: clean),
                        ],
                      ),
                    ),
                  ],
                );
              },
            ),
            if (groups.isNotEmpty) ...[
              const SizedBox(height: AppTheme.s16),
              Text('Waiting with housekeeping', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 4),
              const Text('Receive from each person when they hand their linen to you.', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
              const SizedBox(height: AppTheme.s8),
              for (final g in groups)
                NeuCard(
                  margin: const EdgeInsets.only(bottom: AppTheme.s8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(g.name, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13.5)),
                            const SizedBox(height: 2),
                            Text(
                              '${g.handovers.length} ${g.handovers.length == 1 ? 'room' : 'rooms'} · ${g.pieces} ${g.pieces == 1 ? 'piece' : 'pieces'}',
                              style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                            ),
                          ],
                        ),
                      ),
                      NeuButton(
                        onPressed: state.submitting ? null : () => _receiveHandover(g.movementIds),
                        child: Text('Receive ${g.pieces}'),
                      ),
                    ],
                  ),
                ),
            ],
            const SizedBox(height: AppTheme.s16),
            Row(
              children: [
                Expanded(child: Text('Your linen', style: Theme.of(context).textTheme.titleSmall)),
                _ViewToggle(spreadsheet: _spreadsheet, onChange: (v) => setState(() => _spreadsheet = v)),
                const SizedBox(width: AppTheme.s8),
                TextButton(onPressed: () => showLinenItemFormScreen(context), child: const Text('+ Add item')),
              ],
            ),
            const SizedBox(height: AppTheme.s8),
            if (_spreadsheet)
              _LinenSpreadsheet(
                items: items,
                onEdit: (item) => showLinenItemFormScreen(context, item: item),
                onLoss: (item) => showLinenLossScreen(context, item: item),
                onHide: _hideItem,
              )
            else
              _LinenTable(
                items: items,
                onEdit: (item) => showLinenItemFormScreen(context, item: item),
                onLoss: (item) => showLinenLossScreen(context, item: item),
                onHide: _hideItem,
              ),
            if (hidden.isNotEmpty) ...[
              const SizedBox(height: AppTheme.s8),
              Text('${hidden.length} hidden. Bring back from Add item.', style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
            ],
            const SizedBox(height: AppTheme.s16),
            _LinenHistory(movements: state.board.movements),
          ],
        ],
      ),
    );
  }
}

class _EmptyLinenBoard extends StatelessWidget {
  final ValueChanged<String> onAddStarter;
  final VoidCallback onAdd;

  const _EmptyLinenBoard({required this.onAddStarter, required this.onAdd});

  static const _starters = ['Bedsheet', 'Pillow cover', 'Towel', 'Bath towel', 'Blanket'];

  @override
  Widget build(BuildContext context) {
    return NeuNotice(
      icon: Icons.local_laundry_service_outlined,
      message: 'Add the linen you count.\nAdd each item once, with how many you own. Then track it through the wash.',
      action: Column(
        children: [
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final s in _starters) ActionChip(label: Text('+ $s'), onPressed: () => onAddStarter(s)),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
          NeuButton(onPressed: onAdd, child: const Text('Add another type')),
        ],
      ),
    );
  }
}

/// Switches "Your linen" between the self-labeled card list and a
/// horizontal-scrolling spreadsheet-style table.
class _ViewToggle extends StatelessWidget {
  final bool spreadsheet;
  final ValueChanged<bool> onChange;

  const _ViewToggle({required this.spreadsheet, required this.onChange});

  @override
  Widget build(BuildContext context) {
    Widget btn(IconData icon, bool selected, VoidCallback onTap) => GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        width: 32,
        height: 32,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent : Colors.transparent,
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
        ),
        child: Icon(icon, size: 16, color: selected ? Colors.white : AppTheme.muted),
      ),
    );

    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: AppTheme.bg,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          btn(Icons.view_agenda_outlined, !spreadsheet, () => onChange(false)),
          btn(Icons.table_chart_outlined, spreadsheet, () => onChange(true)),
        ],
      ),
    );
  }
}

/// The same linen stock as a classic spreadsheet: one fixed-width column
/// per field with its full name in the header, scrolling sideways rather
/// than abbreviating on a phone-width screen.
class _LinenSpreadsheet extends StatelessWidget {
  final List<LinenItem> items;
  final ValueChanged<LinenItem> onEdit;
  final ValueChanged<LinenItem> onLoss;
  final ValueChanged<LinenItem> onHide;

  const _LinenSpreadsheet({required this.items, required this.onEdit, required this.onLoss, required this.onHide});

  static const double _nameW = 170;
  static const double _ownedW = 80;
  static const double _statW = 96;
  static const double _actionsW = 44;

  @override
  Widget build(BuildContext context) {
    final totalWidth = _nameW + _ownedW + _statW * 4 + _actionsW;

    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: totalWidth,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.sidebarBrandWash,
                    border: Border(bottom: BorderSide(color: AppTheme.sidebarBrandWashEdge, width: 0.8)),
                  ),
                  child: const Row(
                    children: [
                      _HeaderCell('Linen', width: _nameW, alignStart: true),
                      _HeaderCell('Owned', width: _ownedW),
                      _HeaderCell('To receive', width: _statW),
                      _HeaderCell('Dirty', width: _statW),
                      _HeaderCell('In wash', width: _statW),
                      _HeaderCell('Clean', width: _statW),
                      SizedBox(width: _actionsW),
                    ],
                  ),
                ),
                for (var i = 0; i < items.length; i++)
                  _SpreadsheetRow(
                    item: items[i],
                    shaded: i.isOdd,
                    onEdit: () => onEdit(items[i]),
                    onLoss: () => onLoss(items[i]),
                    onHide: () => onHide(items[i]),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HeaderCell extends StatelessWidget {
  final String label;
  final double width;
  final bool alignStart;
  const _HeaderCell(this.label, {required this.width, this.alignStart = false});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
        child: Text(
          label.toUpperCase(),
          textAlign: alignStart ? TextAlign.left : TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: AppTheme.sidebarBrandInk, fontSize: 10.5, fontWeight: FontWeight.w800, letterSpacing: 0.3),
        ),
      ),
    );
  }
}

class _SpreadsheetRow extends StatelessWidget {
  final LinenItem item;
  final bool shaded;
  final VoidCallback onEdit;
  final VoidCallback onLoss;
  final VoidCallback onHide;

  const _SpreadsheetRow({required this.item, required this.shaded, required this.onEdit, required this.onLoss, required this.onHide});

  @override
  Widget build(BuildContext context) {
    Widget cell(String text, double width, {TextStyle? style, bool alignStart = false}) => SizedBox(
      width: width,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
        child: Text(text, textAlign: alignStart ? TextAlign.left : TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: style),
      ),
    );

    return Container(
      decoration: BoxDecoration(
        color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
        border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          cell(
            item.name,
            _LinenSpreadsheet._nameW,
            alignStart: true,
            style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13),
          ),
          cell(
            '${item.owned}',
            _LinenSpreadsheet._ownedW,
            style: TextStyle(color: item.short ? AppTheme.danger : AppTheme.muted, fontWeight: FontWeight.w600, fontSize: 12.5),
          ),
          cell(item.withHousekeeping.toString(), _LinenSpreadsheet._statW, style: zeroStyle(item.withHousekeeping).copyWith(fontSize: 13)),
          cell(item.dirty.toString(), _LinenSpreadsheet._statW, style: zeroStyle(item.dirty).copyWith(fontSize: 13)),
          cell(item.inLaundry.toString(), _LinenSpreadsheet._statW, style: zeroStyle(item.inLaundry).copyWith(fontSize: 13)),
          cell(item.clean.toString(), _LinenSpreadsheet._statW, style: zeroStyle(item.clean).copyWith(fontSize: 13)),
          SizedBox(
            width: _LinenSpreadsheet._actionsW,
            child: PopupMenuButton<String>(
              padding: EdgeInsets.zero,
              icon: const Icon(Icons.more_vert_rounded, size: 18, color: AppTheme.muted),
              onSelected: (v) => switch (v) {
                'edit' => onEdit(),
                'loss' => onLoss(),
                'hide' => onHide(),
                _ => null,
              },
              elevation: 10,
              color: AppTheme.card,
              shadowColor: AppTheme.heading.withValues(alpha: 0.25),
              offset: const Offset(0, 6),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium), side: const BorderSide(color: AppTheme.border)),
              itemBuilder: (context) => const [
                PopupMenuItem(
                  value: 'edit',
                  height: 40,
                  padding: EdgeInsets.symmetric(horizontal: 6),
                  child: LinenMenuRow(icon: Icons.edit_outlined, label: 'Edit name or count'),
                ),
                PopupMenuItem(
                  value: 'loss',
                  height: 40,
                  padding: EdgeInsets.symmetric(horizontal: 6),
                  child: LinenMenuRow(icon: Icons.report_problem_outlined, label: 'Lost or damaged'),
                ),
                PopupMenuDivider(height: 8),
                PopupMenuItem(
                  value: 'hide',
                  height: 40,
                  padding: EdgeInsets.symmetric(horizontal: 6),
                  child: LinenMenuRow(icon: Icons.visibility_off_outlined, label: 'Hide from list', danger: true),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LinenTable extends StatelessWidget {
  final List<LinenItem> items;
  final ValueChanged<LinenItem> onEdit;
  final ValueChanged<LinenItem> onLoss;
  final ValueChanged<LinenItem> onHide;

  const _LinenTable({
    required this.items,
    required this.onEdit,
    required this.onLoss,
    required this.onHide,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < items.length; i++)
          _LinenCard(
            item: items[i],
            onEdit: () => onEdit(items[i]),
            onLoss: () => onLoss(items[i]),
            onHide: () => onHide(items[i]),
          ),
      ],
    );
  }
}

/// One linen item as a self-labeled card — each stage spells its own name
/// (To receive / Dirty / In wash / Clean) rather than relying on a table
/// header row, which clips on a phone-width screen.
class _LinenCard extends StatelessWidget {
  final LinenItem item;
  final VoidCallback onEdit;
  final VoidCallback onLoss;
  final VoidCallback onHide;

  const _LinenCard({required this.item, required this.onEdit, required this.onLoss, required this.onHide});

  @override
  Widget build(BuildContext context) {
    Widget stat(IconData icon, String label, int n, Color tone) => Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
        decoration: BoxDecoration(
          color: n == 0 ? AppTheme.bg : tone.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
        ),
        child: Column(
          children: [
            Icon(icon, size: 13, color: n == 0 ? AppTheme.muted : tone),
            const SizedBox(height: 3),
            Text('$n', style: TextStyle(color: n == 0 ? AppTheme.muted : AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 1),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 2,
              style: const TextStyle(color: AppTheme.muted, fontSize: 9.5, fontWeight: FontWeight.w600, height: 1.15),
            ),
          ],
        ),
      ),
    );

    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s8, AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rLarge),
        border: Border.all(color: item.short ? AppTheme.danger.withValues(alpha: 0.35) : AppTheme.border),
        boxShadow: AppTheme.extruded,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: AppTheme.sidebarBrandWash, borderRadius: BorderRadius.circular(AppTheme.rMedium)),
                child: const Icon(Icons.local_laundry_service_rounded, size: 18, color: AppTheme.sidebarBrandInk),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14.5)),
                    const SizedBox(height: 1),
                    Row(
                      children: [
                        if (item.short) ...[
                          const Icon(Icons.error_rounded, size: 12, color: AppTheme.danger),
                          const SizedBox(width: 3),
                        ],
                        Flexible(
                          child: Text(
                            item.short ? 'More is out than you own' : '${item.owned} owned',
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: item.short ? AppTheme.danger : AppTheme.muted, fontSize: 11, fontWeight: item.short ? FontWeight.w700 : FontWeight.w400),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              SizedBox(
                width: 32,
                height: 32,
                child: PopupMenuButton<String>(
                  padding: EdgeInsets.zero,
                  icon: const Icon(Icons.more_vert_rounded, size: 18, color: AppTheme.muted),
                  onSelected: (v) => switch (v) {
                    'edit' => onEdit(),
                    'loss' => onLoss(),
                    'hide' => onHide(),
                    _ => null,
                  },
                  elevation: 10,
                  color: AppTheme.card,
                  shadowColor: AppTheme.heading.withValues(alpha: 0.25),
                  offset: const Offset(0, 6),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium), side: const BorderSide(color: AppTheme.border)),
                  itemBuilder: (context) => const [
                    PopupMenuItem(
                      value: 'edit',
                      height: 40,
                      padding: EdgeInsets.symmetric(horizontal: 6),
                      child: LinenMenuRow(icon: Icons.edit_outlined, label: 'Edit name or count'),
                    ),
                    PopupMenuItem(
                      value: 'loss',
                      height: 40,
                      padding: EdgeInsets.symmetric(horizontal: 6),
                      child: LinenMenuRow(icon: Icons.report_problem_outlined, label: 'Lost or damaged'),
                    ),
                    PopupMenuDivider(height: 8),
                    PopupMenuItem(
                      value: 'hide',
                      height: 40,
                      padding: EdgeInsets.symmetric(horizontal: 6),
                      child: LinenMenuRow(icon: Icons.visibility_off_outlined, label: 'Hide from list', danger: true),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              stat(Icons.room_service_outlined, 'To receive', item.withHousekeeping, AppTheme.checkedIn),
              const SizedBox(width: 6),
              stat(Icons.local_laundry_service_outlined, 'Dirty', item.dirty, AppTheme.danger),
              const SizedBox(width: 6),
              stat(Icons.autorenew_rounded, 'In wash', item.inLaundry, AppTheme.edit),
              const SizedBox(width: 6),
              stat(Icons.task_alt_rounded, 'Clean', item.clean, AppTheme.vacant),
            ],
          ),
        ],
      ),
    );
  }
}

class _LinenHistory extends StatefulWidget {
  final List<LinenMovement> movements;
  const _LinenHistory({required this.movements});

  @override
  State<_LinenHistory> createState() => _LinenHistoryState();
}

class _LinenHistoryState extends State<_LinenHistory> {
  bool _open = false;
  String _filter = 'ALL';

  static const _filters = {
    'ALL': null,
    'SENT': ['SENT'],
    'RECEIVED': ['RECEIVED'],
    'ROOMS': ['CHANGED'],
    'LOSS': ['LOST', 'DAMAGED'],
  };

  @override
  Widget build(BuildContext context) {
    final kinds = _filters[_filter];
    final filtered = widget.movements.where((m) => kinds == null || kinds.contains(m.kind)).toList();

    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _open = !_open),
            child: Row(
              children: [
                Expanded(child: Text('History', style: Theme.of(context).textTheme.titleSmall)),
                Icon(_open ? Icons.expand_less_rounded : Icons.expand_more_rounded, color: AppTheme.muted),
              ],
            ),
          ),
          if (_open) ...[
            const SizedBox(height: AppTheme.s8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final key in _filters.keys)
                  _FilterChip(label: key == 'ALL' ? 'All' : key == 'SENT' ? 'Sent' : key == 'RECEIVED' ? 'Received' : key == 'ROOMS' ? 'Rooms' : 'Lost or damaged', selected: _filter == key, onTap: () => setState(() => _filter = key)),
              ],
            ),
            const SizedBox(height: AppTheme.s8),
            if (filtered.isEmpty)
              Text(
                widget.movements.isEmpty ? 'Nothing yet. When linen is changed in a room, sent out or received, it shows here.' : 'Nothing of this kind yet.',
                style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
              )
            else
              for (final m in filtered.take(50)) _MovementRow(movement: m),
          ],
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _FilterChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent : AppTheme.bg,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: selected ? AppTheme.accent : AppTheme.border),
        ),
        child: Text(label, style: TextStyle(color: selected ? Colors.white : AppTheme.text, fontSize: 11.5, fontWeight: FontWeight.w600)),
      ),
    );
  }
}

class _MovementRow extends StatelessWidget {
  final LinenMovement movement;
  const _MovementRow({required this.movement});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${kLinenMoveLabel[movement.kind] ?? movement.kind} · ${movement.itemName}', style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w600)),
                Text(
                  [
                    formatDateTime(movement.createdAt),
                    if (movement.roomNumber != null) 'Room ${movement.roomNumber}',
                    if (movement.washedBy != null) movement.washedBy!,
                  ].join(' · '),
                  style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                ),
              ],
            ),
          ),
          Text('${movement.quantity}', style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13)),
        ],
      ),
    );
  }
}
