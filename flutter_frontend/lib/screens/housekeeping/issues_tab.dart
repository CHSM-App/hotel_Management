import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/housekeeping.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/h_scroll_table.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'housekeeping_parts.dart';

/// Problems and found items cleaners reported while finishing a room —
/// mirrors HousekeepingIssues.jsx: a "Show" filter (open first), cards or a
/// spreadsheet-style table, and one action per open row.
class IssuesTab extends ConsumerStatefulWidget {
  const IssuesTab({super.key});

  @override
  ConsumerState<IssuesTab> createState() => _IssuesTabState();
}

class _IssuesTabState extends ConsumerState<IssuesTab> {
  String _filter = 'OPEN';
  String _view = 'table';
  final _search = TextEditingController();
  // ROOMS | VENUES | BOTH — only offered where there is a choice to make: a
  // property with rooms and events both. Mirrors the `spaces` filter
  // HousekeepingIssues.jsx adds next to Show.
  String _spaces = 'BOTH';
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(housekeepingViewModelProvider.notifier).loadIssues());
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => ref.read(housekeepingViewModelProvider.notifier).loadIssues());
  }

  @override
  void dispose() {
    _search.dispose();
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _close(HousekeepingIssue issue) async {
    final note = await showDialog<String>(
      context: context,
      builder: (_) => _CloseIssueDialog(issue: issue),
    );
    if (note != null) {
      ref.read(housekeepingViewModelProvider.notifier).closeIssue(issue.logId, {'kind': issue.kind, 'note': note});
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(housekeepingViewModelProvider);
    final lodge = ref.watch(authViewModelProvider).me?.lodge;
    // Only where there is a choice to make: a property with rooms and events
    // both. Mirrors `bothKinds` in HousekeepingIssues.jsx.
    final bothKinds = (lodge?.hasEvents ?? false) && (lodge?.hasRooms ?? false);

    final inSpaces = state.issues
        .where((i) => !bothKinds || _spaces == 'BOTH' || (_spaces == 'VENUES') == i.isVenue)
        .toList();
    final open = inSpaces.where((i) => i.isOpen).toList();
    final closed = inSpaces.where((i) => !i.isOpen).toList();
    final needle = _search.text.trim().toLowerCase();
    final byFilter = switch (_filter) {
      'OPEN' => open,
      'CLOSED' => closed,
      _ => [...open, ...closed],
    };
    final shown = needle.isEmpty
        ? byFilter
        : byFilter.where((i) => [i.roomNumber, i.text, i.reportedBy ?? ''].any((v) => v.toLowerCase().contains(needle))).toList();

    final filters = [
      FilterOption('OPEN', 'Open', open.length),
      FilterOption('CLOSED', 'Closed', closed.length),
      FilterOption('ALL', 'All', open.length + closed.length),
    ];
    final spaceFilters = [
      FilterOption('BOTH', 'Rooms and venues', state.issues.length),
      FilterOption('ROOMS', 'Rooms only', state.issues.where((i) => !i.isVenue).length),
      FilterOption('VENUES', 'Venues only', state.issues.where((i) => i.isVenue).length),
    ];
    // "a room", "a venue" or "a room or a venue" — mirrors `place` on the web.
    final place = bothKinds ? 'a room or a venue' : (lodge?.hasEvents ?? false) ? 'a venue' : 'a room';

    if (state.issuesLoading && state.issues.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    return RefreshIndicator(
      // In table view the scroll is the rows', a level below the
      // table's horizontal scroller.
      notificationPredicate: (n) => n.metrics.axis == Axis.vertical,
      onRefresh: () => ref.read(housekeepingViewModelProvider.notifier).loadIssues(),
      color: AppTheme.accent,
      child: TablePageBody(
        table: _view == 'table',
        padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
        children: [
          if (state.error != null) ...[
            HkErrorBanner(state.error!),
            const SizedBox(height: AppTheme.s12),
          ],
          HkSearchBar(
            controller: _search,
            onChanged: (_) => setState(() {}),
            hint: 'Search room, venue or note',
            filter: FilterDropdownButton(
              compact: true,
              options: filters,
              selected: _filter,
              onSelect: (v) => setState(() => _filter = v),
              extraOptions: bothKinds ? spaceFilters : null,
              extraSelected: bothKinds ? _spaces : null,
              onExtraSelect: (v) => setState(() => _spaces = v),
            ),
            viewToggle: HkViewToggle(view: _view, onSelect: (v) => setState(() => _view = v)),
          ),
          const SizedBox(height: AppTheme.s12),
          if (shown.isEmpty && needle.isNotEmpty)
            const NeuNotice(icon: Icons.search_off_rounded, message: 'Nothing matches this search.')
          else if (shown.isEmpty)
            NeuNotice(
              icon: Icons.task_alt_rounded,
              message: _filter == 'CLOSED'
                  ? 'Nothing closed yet. Problems you mark fixed and items you hand over move here.'
                  : _filter == 'OPEN'
                      ? 'Nothing waiting. When a cleaner reports a problem or a found item while finishing $place, it appears here.'
                      : 'Nothing reported yet.',
            )
          else if (_view == 'table')
            _IssuesTable(issues: shown, placeHead: bothKinds ? 'Room / Venue' : (lodge?.hasEvents ?? false) ? 'Venue' : 'Room', busyIssueKey: state.busyIssueKey, onClose: _close)
          else
            for (final i in shown) _IssueCard(issue: i, busy: state.busyIssueKey == i.key, onClose: () => _close(i)),
        ],
      ),
    );
  }
}

class _IssueCard extends StatelessWidget {
  final HousekeepingIssue issue;
  final bool busy;
  final VoidCallback onClose;
  const _IssueCard({required this.issue, required this.busy, required this.onClose});

  @override
  Widget build(BuildContext context) {
    final tone = issue.closedAt != null ? AppTheme.checkedIn : (issue.kind == 'ISSUE' ? AppTheme.muted : AppTheme.edit);
    final when = issue.closedAt != null
        ? '${dayLabel(issue.closedAt!)}${issue.closedBy != null ? ' · ${issue.closedBy}' : ''}'
        : '${ago(issue.reportedAt, DateTime.now())} ago${issue.reportedBy != null ? ' · ${issue.reportedBy}' : ''}';

    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        border: Border.all(color: AppTheme.border),
        boxShadow: AppTheme.extruded,
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.s8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 38,
              height: 38,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: tone.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
              // A venue's name is too long for this tile, as on the cleaning
              // board: the tile says what it is and the name sits over the
              // report below, mirroring the web's hk-card__room--venue.
              child: issue.isVenue
                  ? Icon(Icons.celebration_rounded, color: tone, size: 16)
                  : Text(issue.roomNumber, style: TextStyle(color: tone, fontWeight: FontWeight.w800, fontSize: 12.5)),
            ),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (issue.isVenue)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: Text(issue.roomNumber, style: const TextStyle(color: AppTheme.muted, fontWeight: FontWeight.w700, fontSize: 11)),
                    ),
                  Text(issue.text, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13)),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      StatusPill(label: kIssueKindLabel[issue.kind] ?? issue.kind, color: tone),
                      const SizedBox(width: 6),
                      Expanded(child: Text(when, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5), maxLines: 1, overflow: TextOverflow.ellipsis)),
                    ],
                  ),
                  if (issue.resolution != null && issue.resolution!.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(issue.resolution!, style: const TextStyle(color: AppTheme.text, fontSize: 11.5)),
                  ],
                  if (issue.roomBlocked) ...[
                    const SizedBox(height: 4),
                    const StatusPill(label: 'Held under repair', color: AppTheme.danger),
                  ],
                ],
              ),
            ),
            if (issue.isOpen) ...[
              const SizedBox(width: AppTheme.s8),
              CompactActionButton(label: kIssueKindCloseLabel[issue.kind] ?? 'Close', color: AppTheme.accent, onTap: busy ? null : onClose),
            ],
          ],
        ),
      ),
    );
  }
}

/// The spreadsheet-style view — mirrors the table in HousekeepingIssues.jsx:
/// room, reported, type, reported by, waiting/closed, and (once something
/// shown is closed) a note column.
class _IssuesTable extends StatelessWidget {
  final List<HousekeepingIssue> issues;
  final String placeHead;
  final String? busyIssueKey;
  final ValueChanged<HousekeepingIssue> onClose;

  const _IssuesTable({required this.issues, required this.placeHead, required this.busyIssueKey, required this.onClose});

  static const _actionsWidth = 140.0;

  @override
  Widget build(BuildContext context) {
    final anyClosed = issues.any((i) => !i.isOpen);
    final columns = [
      (label: placeHead, width: 90.0),
      (label: 'Type', width: 110.0),
      (label: 'Reported by', width: 120.0),
      (label: 'When', width: 130.0),
      if (anyClosed) (label: 'Note', width: 160.0),
    ];
    final width = columns.fold<double>(0, (sum, c) => sum + c.width) + 240 + _actionsWidth;

    return NeuCard(
      padding: EdgeInsets.zero,
      radius: AppTheme.rMedium,
      shadow: AppTheme.subtle,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        child: HScrollTable(
          rowsScrollbar: true,
          child: SizedBox(
            width: width,
            child: StickyHeaderTable(
              header: Container(
                  decoration: const BoxDecoration(
                    color: AppTheme.sidebarBrandWash,
                    border: Border(bottom: BorderSide(color: AppTheme.sidebarBrandWashEdge, width: 0.8)),
                  ),
                  child: Row(
                    children: [
                      const SizedBox(width: 240, child: HkTableHeaderCell('Problem / item')),
                      for (final c in columns) SizedBox(width: c.width, child: HkTableHeaderCell(c.label)),
                      const SizedBox(width: _actionsWidth, child: HkTableHeaderCell('Action')),
                    ],
                  ),
                ),
              rows: [
                      for (var i = 0; i < issues.length; i++) _IssueTableRow(issue: issues[i], shaded: i.isOdd, anyClosed: anyClosed, busy: busyIssueKey == issues[i].key, onClose: () => onClose(issues[i])),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _IssueTableRow extends StatelessWidget {
  final HousekeepingIssue issue;
  final bool shaded;
  final bool anyClosed;
  final bool busy;
  final VoidCallback onClose;

  const _IssueTableRow({required this.issue, required this.shaded, required this.anyClosed, required this.busy, required this.onClose});

  @override
  Widget build(BuildContext context) {
    final tone = issue.closedAt != null ? AppTheme.checkedIn : (issue.kind == 'ISSUE' ? AppTheme.muted : AppTheme.edit);
    final when = issue.closedAt != null ? dayLabel(issue.closedAt!) : '${ago(issue.reportedAt, DateTime.now())} ago';

    Widget cell(double width, Widget child) => SizedBox(width: width, child: Padding(padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10), child: child));
    Widget text(String? s) => Text(s == null || s.isEmpty ? '—' : s, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: s == null || s.isEmpty ? AppTheme.muted : AppTheme.text, fontSize: 12.5));

    return Container(
      decoration: BoxDecoration(
        color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
        border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          cell(240, Text(issue.text, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w600))),
          cell(90, Text(issue.roomNumber, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppTheme.heading, fontSize: 12.5, fontWeight: FontWeight.w700))),
          cell(110, Align(alignment: Alignment.centerLeft, child: StatusPill(label: kIssueKindLabel[issue.kind] ?? issue.kind, color: tone))),
          cell(120, text(issue.reportedBy)),
          cell(130, text(when)),
          if (anyClosed) cell(160, text(issue.resolution)),
          SizedBox(
            width: _IssuesTable._actionsWidth,
            child: issue.isOpen
                ? Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8),
                    child: Align(
                      alignment: Alignment.centerRight,
                      child: busy
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : FittedBox(
                              fit: BoxFit.scaleDown,
                              child: CompactActionButton(label: kIssueKindCloseLabel[issue.kind] ?? 'Close', color: AppTheme.accent, onTap: onClose),
                            ),
                    ),
                  )
                : null,
          ),
        ],
      ),
    );
  }
}

/// Owns the note controller so it is disposed with the dialog's own state,
/// not while the route's exit animation is still building the TextField.
class _CloseIssueDialog extends StatefulWidget {
  const _CloseIssueDialog({required this.issue});
  final HousekeepingIssue issue;

  @override
  State<_CloseIssueDialog> createState() => _CloseIssueDialogState();
}

class _CloseIssueDialogState extends State<_CloseIssueDialog> {
  final _note = TextEditingController();
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  @override
  void dispose() {
    _focus.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final issue = widget.issue;
    final closeLabel = kIssueKindCloseLabel[issue.kind] ?? 'Close';
    return AlertDialog(
      backgroundColor: AppTheme.card,
      insetPadding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s24),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rLarge)),
      titlePadding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      contentPadding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
      actionsPadding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
      title: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppTheme.vacant.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.build_circle_rounded, color: AppTheme.vacant, size: 22),
          ),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Text(
              '${issue.spaceLabel} · ${closeLabel.toLowerCase()}?',
              style: const TextStyle(color: AppTheme.heading, fontSize: 18, fontWeight: FontWeight.w800, letterSpacing: -0.2),
            ),
          ),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
            decoration: BoxDecoration(
              color: AppTheme.bg,
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
              border: Border.all(color: AppTheme.border),
            ),
            child: Text(issue.text, style: const TextStyle(color: AppTheme.text, fontSize: 13)),
          ),
          const SizedBox(height: AppTheme.s16),
          NeuField(
            controller: _note,
            label: kIssueKindQuestion[issue.kind] ?? 'Note (optional)',
            hint: issueCloseHint(issue),
            focusNode: _focus,
          ),
          if (issue.roomBlocked) ...[
            const SizedBox(height: AppTheme.s12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.info_outline_rounded, size: 16, color: AppTheme.muted),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    '${issue.spaceLabel} is held under repair for this. Marking it fixed sends it to the cleaning list.',
                    style: const TextStyle(color: AppTheme.muted, fontSize: 12, height: 1.35),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
      actions: [
        Row(
          children: [
            Expanded(
              child: NeuButton(
                onPressed: () => Navigator.pop(context),
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: const Text('Not yet', style: TextStyle(fontSize: 13)),
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              flex: 2,
              child: NeuButton(
                primary: true,
                onPressed: () => Navigator.pop(context, _note.text.trim()),
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Text(closeLabel, style: const TextStyle(fontSize: 13)),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
