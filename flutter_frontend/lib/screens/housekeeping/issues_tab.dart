import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/housekeeping.dart';
import '../../presentation/providers/view_model_provider.dart';
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
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _close(HousekeepingIssue issue) async {
    final note = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text('${issue.spaceLabel} · ${(kIssueKindCloseLabel[issue.kind] ?? '').toLowerCase()}?', style: const TextStyle(color: AppTheme.heading)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(issue.text, style: const TextStyle(color: AppTheme.text, fontSize: 12.5)),
            const SizedBox(height: AppTheme.s12),
            TextField(
              controller: note,
              autofocus: true,
              decoration: InputDecoration(labelText: kIssueKindQuestion[issue.kind], hintText: issueCloseHint(issue), border: const OutlineInputBorder()),
            ),
            if (issue.roomBlocked) ...[
              const SizedBox(height: AppTheme.s8),
              Text('${issue.spaceLabel} is held under repair for this. Marking it fixed sends it to the cleaning list.', style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
            ],
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Not yet')),
          TextButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(kIssueKindCloseLabel[issue.kind] ?? 'Close')),
        ],
      ),
    );
    if (confirmed == true) {
      ref.read(housekeepingViewModelProvider.notifier).closeIssue(issue.logId, {'kind': issue.kind, 'note': note.text.trim()});
    }
    note.dispose();
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
    final shown = switch (_filter) {
      'OPEN' => open,
      'CLOSED' => closed,
      _ => [...open, ...closed],
    };

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
      onRefresh: () => ref.read(housekeepingViewModelProvider.notifier).loadIssues(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (state.error != null) ...[
            HkErrorBanner(state.error!),
            const SizedBox(height: AppTheme.s12),
          ],
          Row(
            children: [
              FilterDropdownButton(options: filters, selected: _filter, onSelect: (v) => setState(() => _filter = v)),
              const Spacer(),
              HkViewToggle(view: _view, onSelect: (v) => setState(() => _view = v)),
            ],
          ),
          if (bothKinds) ...[
            const SizedBox(height: AppTheme.s8),
            FilterDropdownButton(options: spaceFilters, selected: _spaces, onSelect: (v) => setState(() => _spaces = v), label: 'Spaces'),
          ],
          const SizedBox(height: AppTheme.s12),
          if (shown.isEmpty)
            NeuNotice(
              icon: Icons.task_alt_rounded,
              message: _filter == 'CLOSED'
                  ? 'Nothing closed yet. Problems you mark fixed and items you hand over move here.'
                  : _filter == 'OPEN'
                      ? 'Nothing waiting. When a cleaner reports a problem or a found item while finishing $place, it appears here.'
                      : 'Nothing reported yet.',
            )
          else if (_view == 'table')
            _IssuesTable(issues: shown, placeHead: bothKinds ? 'Room / Venue' : (lodge?.hasEvents ?? false) ? 'Venue' : 'Room', onClose: _close)
          else
            for (final i in shown) _IssueCard(issue: i, onClose: () => _close(i)),
        ],
      ),
    );
  }
}

class _IssueCard extends StatelessWidget {
  final HousekeepingIssue issue;
  final VoidCallback onClose;
  const _IssueCard({required this.issue, required this.onClose});

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
              CompactActionButton(label: kIssueKindCloseLabel[issue.kind] ?? 'Close', color: AppTheme.accent, onTap: onClose),
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
  final ValueChanged<HousekeepingIssue> onClose;

  const _IssuesTable({required this.issues, required this.placeHead, required this.onClose});

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
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SizedBox(
            width: width,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
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
                for (var i = 0; i < issues.length; i++) _IssueTableRow(issue: issues[i], shaded: i.isOdd, anyClosed: anyClosed, onClose: () => onClose(issues[i])),
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
  final VoidCallback onClose;

  const _IssueTableRow({required this.issue, required this.shaded, required this.anyClosed, required this.onClose});

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
                      child: FittedBox(
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
