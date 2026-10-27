import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../domain/models/enquiry.dart';
import '../bookings/take_booking_screen.dart';
import '../events/event_form_screen.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/h_scroll_table.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

const _kindLabel = {
  'ROOM': 'Room',
  'EVENT': 'Event',
  'SERVICE': 'Service',
  'GENERAL': 'General',
};

const _statusLabel = {
  'NEW': 'New',
  'CONTACTED': 'Contacted',
  'CONVERTED': 'Converted',
  'CLOSED': 'Closed',
};

// Contacted isn't offered any more: nothing sets it now that ROOM/EVENT
// enquiries convert through "Confirm booking". _statusLabel keeps it so an
// older enquiry already in that status still reads properly.
const _filters = ['ALL', 'NEW', 'CONVERTED', 'CLOSED'];

Color _statusColor(String status) => switch (status) {
  'NEW' => AppTheme.accent,
  'CONTACTED' => AppTheme.checkout,
  'CONVERTED' => AppTheme.vacant,
  _ => AppTheme.muted,
};

/// "12 Oct" for a date-only value — the dates a guest asked for, which have
/// no time worth showing.
String _shortDay(String? iso) {
  if (iso == null || iso.isEmpty) return '';
  final d = DateTime.tryParse(iso);
  if (d == null) return '';
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${d.day} ${months[d.month - 1]}';
}

/// What the guest actually asked for, as one short line. The full message
/// they composed is on `notes`.
String _lookingFor(Enquiry e) {
  final guests = e.guests == null
      ? ''
      : '${e.guests} guest${e.guests == 1 ? '' : 's'}';
  final parts = <String>[];
  if (e.kind == 'ROOM') {
    if (e.checkInDate != null) {
      parts.add('${_shortDay(e.checkInDate)} → ${_shortDay(e.checkOutDate)}');
    }
    if (guests.isNotEmpty) parts.add(guests);
  } else if (e.kind == 'EVENT') {
    if ((e.eventType ?? '').isNotEmpty) parts.add(e.eventType!);
    if (e.eventDate != null) parts.add(_shortDay(e.eventDate));
    if (guests.isNotEmpty) parts.add(guests);
  } else {
    return (e.notes ?? '').isNotEmpty ? 'See note' : '—';
  }
  return parts.isEmpty ? '—' : parts.join(' · ');
}

/// ROOM and EVENT enquiries convert by opening a pre-filled booking form —
/// "Confirm booking". Nothing else names a booking to confirm into, so those
/// keep the plain "Converted" button.
bool _canConfirm(Enquiry e) => e.kind == 'ROOM' || e.kind == 'EVENT';

/// "12 Oct 2026" — the detail sheet names single dates on their own, so the
/// year is part of the answer.
String _longDay(String? iso) {
  if (iso == null || iso.isEmpty) return '';
  final d = DateTime.tryParse(iso);
  if (d == null) return '';
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${d.day} ${months[d.month - 1]} ${d.year}';
}

/// 10-digit numbers get the country code; anything else is passed through as
/// digits rather than guessed at — a wrong country code messages a stranger.
String _whatsAppDigits(String raw) {
  final digits = raw.replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) return '';
  if (digits.length == 10) return '91$digits';
  if (digits.length == 11 && digits.startsWith('0')) {
    return '91${digits.substring(1)}';
  }
  return digits;
}

/// Enquiries guests send from the lodge's public page — follow up, then mark
/// them Converted. Mirrors Enquiries.jsx: a search box, status filters with
/// counts, and one card per enquiry with its status moves.
class EnquiriesScreen extends ConsumerStatefulWidget {
  const EnquiriesScreen({super.key});

  @override
  ConsumerState<EnquiriesScreen> createState() => _EnquiriesScreenState();
}

class _EnquiriesScreenState extends ConsumerState<EnquiriesScreen> {
  final _search = TextEditingController();
  String _filter = 'NEW';

  /// null = the spreadsheet view; the toggle switches to cards.
  String? _view;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      final vm = ref.read(enquiriesViewModelProvider.notifier);
      vm.load();
      vm.loadCatalogue();
    });
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool _matches(Enquiry e) {
    final q = _search.text.trim().toLowerCase();
    if (q.isEmpty) return true;
    return [e.name, e.phone, e.referenceCode, _kindLabel[e.kind]].any(
      (v) => (v ?? '').toLowerCase().contains(q),
    );
  }

  Future<void> _setStatus(Enquiry e, String status) async {
    final ok = await ref
        .read(enquiriesViewModelProvider.notifier)
        .setStatus(e.id, status);
    if (!mounted) return;
    if (!ok) {
      final message =
          ref.read(enquiriesViewModelProvider).error ??
          'Could not update this enquiry.';
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
      return;
    }
    // The bell counts NEW enquiries — update it straight away.
    ref.read(staffAlertsViewModelProvider.notifier).refreshEnquiries();
  }

  /// A row/card action: the two non-status ones ride the same callback.
  void _act(Enquiry e, String action) {
    switch (action) {
      case 'CONFIRM':
        _confirm(e);
      case 'DETAILS':
        _showDetails(e);
      default:
        _setStatus(e, action);
    }
  }

  /// "Confirm booking": opens the booking / function form pre-filled from the
  /// enquiry. Nothing is saved here — the server marks the enquiry Converted
  /// in the same transaction as the booking the desk actually saves. Closing
  /// the form without saving just pops back to this list.
  Future<void> _confirm(Enquiry e) async {
    final catalogue = ref.read(enquiriesViewModelProvider).catalogue;
    final Widget form;
    if (e.kind == 'EVENT') {
      final date = e.eventDate;
      form = EventFormScreen(
        prefillEnquiry: e,
        initialDate: date != null && date.length >= 10
            ? date.substring(0, 10)
            : null,
      );
    } else {
      final extras = catalogue.extrasFor(e);
      form = TakeBookingScreen(
        prefillEnquiry: e,
        prefillExtrasNote: extras.isEmpty ? null : extras.join(', '),
      );
    }
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => form));
    if (!mounted) return;
    // It may have been converted by the save.
    ref.read(enquiriesViewModelProvider.notifier).load();
    ref.read(staffAlertsViewModelProvider.notifier).refreshEnquiries();
  }

  void _showDetails(Enquiry e) {
    final catalogue = ref.read(enquiriesViewModelProvider).catalogue;
    final rows = <(String, String)>[
      ('Phone', e.phone),
      ('Type', _kindLabel[e.kind] ?? e.kind),
      ('Status', _statusLabel[e.status] ?? e.status),
      if (e.kind == 'ROOM') ...[
        if (e.checkInDate != null) ('Check-in', _longDay(e.checkInDate)),
        if (e.checkOutDate != null) ('Check-out', _longDay(e.checkOutDate)),
        if (e.roomTypeId != null && catalogue.roomTypes[e.roomTypeId] != null)
          ('Room type', catalogue.roomTypes[e.roomTypeId]!),
      ],
      if (e.kind == 'EVENT') ...[
        if (e.eventDate != null) ('Event date', _longDay(e.eventDate)),
        if ((e.eventType ?? '').isNotEmpty) ('Event type', e.eventType!),
        if (e.venueId != null && catalogue.venues[e.venueId] != null)
          ('Venue', catalogue.venues[e.venueId]!),
      ],
      if (e.guests != null) ('Guests', '${e.guests}'),
      if (catalogue.extrasFor(e).isNotEmpty)
        ('Extras', catalogue.extrasFor(e).join(', ')),
      if ((e.notes ?? '').isNotEmpty) ('Notes', e.notes!),
      ('Received', formatDateTime(e.createdAt)),
      if (e.handledAt != null) ('Handled', formatDateTime(e.handledAt)),
    ];
    showDialog<void>(
      context: context,
      builder: (sheet) => Dialog(
        backgroundColor: AppTheme.card,
        insetPadding: const EdgeInsets.all(AppTheme.s16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.rLarge),
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 440),
          child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppTheme.s16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(e.name, style: Theme.of(sheet).textTheme.titleMedium),
                        Text(
                          e.referenceCode,
                          style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.close_rounded, color: AppTheme.muted),
                    onPressed: () => Navigator.of(sheet).pop(),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s12),
              for (final (label, value) in rows)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 96,
                        child: Text(
                          label,
                          style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
                        ),
                      ),
                      Expanded(
                        child: Text(value, style: const TextStyle(fontSize: 13.5)),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: AppTheme.s12),
              Wrap(
                spacing: AppTheme.s8,
                runSpacing: AppTheme.s8,
                children: [
                  _ActionButton(
                    label: 'WhatsApp',
                    icon: Icons.chat_rounded,
                    onTap: () => _openWhatsApp(e),
                  ),
                  if (e.isOpen && _canConfirm(e))
                    _ActionButton(
                      label: 'Confirm booking',
                      primary: true,
                      onTap: () {
                        Navigator.of(sheet).pop();
                        _confirm(e);
                      },
                    ),
                  if (e.isOpen && !_canConfirm(e))
                    _ActionButton(
                      label: 'Converted',
                      primary: true,
                      onTap: () {
                        Navigator.of(sheet).pop();
                        _setStatus(e, 'CONVERTED');
                      },
                    ),
                  if (e.isOpen)
                    _ActionButton(
                      label: 'Close enquiry',
                      onTap: () {
                        Navigator.of(sheet).pop();
                        _setStatus(e, 'CLOSED');
                      },
                    )
                  else
                    _ActionButton(
                      label: 'Reopen',
                      onTap: () {
                        Navigator.of(sheet).pop();
                        _setStatus(e, 'NEW');
                      },
                    ),
                ],
              ),
            ],
          ),
        ),
        ),
      ),
    );
  }

  Future<void> _openWhatsApp(Enquiry e) async {
    final digits = _whatsAppDigits(e.phone);
    if (digits.isEmpty) return;
    await launchUrl(
      Uri.parse('https://wa.me/$digits'),
      mode: LaunchMode.externalApplication,
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(enquiriesViewModelProvider);
    final rows = state.rows;

    if (rows == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final searched = rows.where(_matches).toList();
    final counts = {
      for (final f in _filters)
        f: f == 'ALL'
            ? searched.length
            : searched.where((r) => r.status == f).length,
    };
    final visible = searched
        .where((r) => _filter == 'ALL' || r.status == _filter)
        .toList()
      ..sort((a, b) => (b.createdAt ?? '').compareTo(a.createdAt ?? ''));

    final view =
        _view ?? 'table';

    return RefreshIndicator(
      notificationPredicate: (n) => n.metrics.axis == Axis.vertical,
      onRefresh: () => ref.read(enquiriesViewModelProvider.notifier).load(),
      color: AppTheme.accent,
      child: TablePageBody(
        table: view == 'table',
        padding: const EdgeInsets.fromLTRB(
          AppTheme.s12,
          AppTheme.s8,
          AppTheme.s12,
          AppTheme.s24,
        ),
        children: [
          if (state.error != null && rows.isEmpty)
            NeuNotice(
              icon: Icons.cloud_off_rounded,
              message: state.error!,
              action: NeuButton(
                onPressed: () =>
                    ref.read(enquiriesViewModelProvider.notifier).load(),
                child: const Text('Try again'),
              ),
            )
          else if (rows.isEmpty)
            const NeuNotice(
              icon: Icons.mark_chat_unread_rounded,
              message:
                  'No enquiries yet. When a guest sends one from your public page it appears here.',
            )
          else ...[
            Row(
              children: [
                Expanded(
                  child: _SearchBar(
                    controller: _search,
                    onChanged: () => setState(() {}),
                  ),
                ),
                const SizedBox(width: AppTheme.s8),
                NeuFilterButton(
                  onReset: () => setState(() => _filter = 'NEW'),
                  active: _filter != 'NEW',
                  builder: (close) => NeuFilterPanel(
                    title: 'FILTER BY STATUS',
                    children: [
                      for (final f in _filters)
                        NeuFilterRow(
                          label: f == 'ALL' ? 'All' : _statusLabel[f]!,
                          count: counts[f] ?? 0,
                          on: _filter == f,
                          icon: f == 'ALL' ? Icons.apps_rounded : Icons.mark_email_unread_rounded,
                          onTap: () {
                            setState(() => _filter = f);
                            close();
                          },
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: AppTheme.s8),
                _ViewToggleButton(
                  view: view,
                  onSelect: (v) => setState(() => _view = v),
                ),
              ],
            ),
            const SizedBox(height: AppTheme.s8),
            if (visible.isEmpty)
              const NeuNotice(
                icon: Icons.search_off_rounded,
                message: 'No enquiries match your search or filter.',
              )
            else ...[
              if (view == 'table')
                _EnquiryTable(
                  enquiries: visible,
                  busyId: state.busyId,
                  onWhatsApp: _openWhatsApp,
                  onStatus: _act,
                )
              else
                LayoutBuilder(
                  builder: (context, constraints) {
                    const gap = AppTheme.s8;
                    final cols = constraints.maxWidth >= 920
                        ? 3
                        : (constraints.maxWidth >= 520 ? 2 : 1);
                    final width = cols == 1
                        ? constraints.maxWidth
                        : (constraints.maxWidth - gap * (cols - 1)) / cols;
                    return Wrap(
                      spacing: gap,
                      runSpacing: gap,
                      children: [
                        for (final e in visible)
                          SizedBox(
                            width: width,
                            child: _EnquiryCard(
                              enquiry: e,
                              busy: state.busyId == e.id,
                              onWhatsApp: () => _openWhatsApp(e),
                              onStatus: (s) => _act(e, s),
                            ),
                          ),
                      ],
                    );
                  },
                ),
              Padding(
                padding: const EdgeInsets.only(top: AppTheme.s4),
                child: Text(
                  '${visible.length} enquir${visible.length == 1 ? 'y' : 'ies'} · '
                  'Enquiries are kept for 30 days. Tap Confirm booking to turn one into a booking.',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

/// Pill search box — same construction as the Customers register's.
class _SearchBar extends StatelessWidget {
  final TextEditingController controller;
  final VoidCallback onChanged;

  const _SearchBar({required this.controller, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s4),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.shadowDark, width: 1.3),
        boxShadow: AppTheme.subtle,
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppTheme.accent.withValues(alpha: 0.10),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.search_rounded, size: 15, color: AppTheme.accent),
          ),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: (_) => onChanged(),
              style: const TextStyle(color: AppTheme.heading, fontSize: 14),
              decoration: const InputDecoration(
                hintText: 'Search guest, phone or reference',
                hintStyle: TextStyle(color: AppTheme.muted, fontSize: 14),
                border: InputBorder.none,
                isDense: true,
                contentPadding: EdgeInsets.symmetric(vertical: 10),
              ),
            ),
          ),
          if (controller.text.isNotEmpty)
            GestureDetector(
              onTap: () {
                controller.clear();
                onChanged();
              },
              behavior: HitTestBehavior.opaque,
              child: Container(
                width: 26,
                height: 26,
                margin: const EdgeInsets.only(right: 2),
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: AppTheme.bg, shape: BoxShape.circle),
                child: const Icon(Icons.close_rounded, size: 15, color: AppTheme.muted),
              ),
            ),
        ],
      ),
    );
  }
}

/// Cards vs. spreadsheet toggle — same as the other registers.
class _ViewToggleButton extends StatelessWidget {
  final String view;
  final ValueChanged<String> onSelect;

  const _ViewToggleButton({required this.view, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    Widget seg(String v, IconData icon) {
      final isSelected = v == view;
      return GestureDetector(
        onTap: () => onSelect(v),
        behavior: HitTestBehavior.opaque,
        child: Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: isSelected ? AppTheme.accent : Colors.transparent,
            borderRadius: BorderRadius.circular(AppTheme.rSmall - 2),
          ),
          child: Icon(icon, size: 17, color: isSelected ? Colors.white : AppTheme.muted),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: AppTheme.card,
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          seg('cards', Icons.view_agenda_outlined),
          seg('table', Icons.table_rows_outlined),
        ],
      ),
    );
  }
}

// ── Spreadsheet view ────────────────────────────────────────────────────

class _Col {
  final String key;
  final String label;
  final double width;
  const _Col(this.key, this.label, this.width);
}

const _cols = [
  _Col('name', 'Guest', 150),
  _Col('ref', 'Reference', 110),
  _Col('phone', 'Phone', 120),
  _Col('kind', 'Type', 80),
  _Col('looking', 'Looking for', 190),
  _Col('status', 'Status', 100),
  _Col('received', 'Received', 140),
];

class _EnquiryTable extends StatelessWidget {
  final List<Enquiry> enquiries;
  final int? busyId;
  final ValueChanged<Enquiry> onWhatsApp;
  final void Function(Enquiry, String) onStatus;

  const _EnquiryTable({
    required this.enquiries,
    required this.busyId,
    required this.onWhatsApp,
    required this.onStatus,
  });

  @override
  Widget build(BuildContext context) {
    final width = _cols.fold<double>(0, (sum, c) => sum + c.width) + 36;
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
                  border: Border(
                    bottom: BorderSide(color: AppTheme.sidebarBrandWashEdge, width: 0.8),
                  ),
                ),
                child: Row(
                  children: [
                    for (final c in _cols)
                      SizedBox(
                        width: c.width,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                          child: Text(
                            c.label.toUpperCase(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.black,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                      ),
                    const SizedBox(width: 36),
                  ],
                ),
              ),
              rows: [
                for (var i = 0; i < enquiries.length; i++)
                  _EnquiryTableRow(
                    enquiry: enquiries[i],
                    shaded: i.isOdd,
                    busy: busyId == enquiries[i].id,
                    onWhatsApp: () => onWhatsApp(enquiries[i]),
                    onStatus: (s) => onStatus(enquiries[i], s),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EnquiryTableRow extends StatelessWidget {
  final Enquiry enquiry;
  final bool shaded;
  final bool busy;
  final VoidCallback onWhatsApp;
  final ValueChanged<String> onStatus;

  const _EnquiryTableRow({
    required this.enquiry,
    required this.shaded,
    required this.busy,
    required this.onWhatsApp,
    required this.onStatus,
  });

  @override
  Widget build(BuildContext context) {
    final e = enquiry;
    final color = _statusColor(e.status);
    final cells = {
      'name': e.name,
      'ref': e.referenceCode,
      'phone': e.phone,
      'kind': _kindLabel[e.kind] ?? e.kind,
      'looking': _lookingFor(e),
      'received': formatDateTime(e.createdAt),
    };

    return InkWell(
      onTap: () => onStatus('DETAILS'),
      child: Container(
      decoration: BoxDecoration(
        color: shaded ? AppTheme.border.withValues(alpha: 0.25) : AppTheme.card,
        border: const Border(bottom: BorderSide(color: AppTheme.border, width: 0.8)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          for (final c in _cols)
            SizedBox(
              width: c.width,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: 10),
                child: c.key == 'status'
                    ? Align(
                        alignment: Alignment.centerLeft,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: color.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            _statusLabel[e.status] ?? e.status,
                            style: TextStyle(
                              color: color,
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      )
                    : Text(
                        cells[c.key] ?? '',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: c.key == 'ref' || c.key == 'received'
                              ? AppTheme.muted
                              : AppTheme.text,
                          fontSize: 12.5,
                          fontWeight: c.key == 'name' ? FontWeight.w600 : FontWeight.w400,
                        ),
                      ),
              ),
            ),
          SizedBox(
            width: 36,
            child: NeuActionMenu<String>(
              iconSize: 18,
              actions: [
                const NeuMenuAction('wa', Icons.chat_rounded, 'WhatsApp'),
                if (e.isOpen) ...[
                  if (_canConfirm(e))
                    const NeuMenuAction('CONFIRM', Icons.event_available_rounded, 'Confirm booking')
                  else
                    const NeuMenuAction('CONVERTED', Icons.check_circle_outline_rounded, 'Mark converted'),
                  const NeuMenuAction('CLOSED', Icons.close_rounded, 'Close'),
                ] else
                  const NeuMenuAction('NEW', Icons.replay_rounded, 'Reopen'),
              ],
              onSelected: (v) {
                if (v == 'wa') {
                  onWhatsApp();
                } else if (!busy) {
                  onStatus(v);
                }
              },
            ),
          ),
        ],
      ),
      ),
    );
  }
}

class _EnquiryCard extends StatelessWidget {
  final Enquiry enquiry;
  final bool busy;
  final VoidCallback onWhatsApp;
  final ValueChanged<String> onStatus;

  const _EnquiryCard({
    required this.enquiry,
    required this.busy,
    required this.onWhatsApp,
    required this.onStatus,
  });

  @override
  Widget build(BuildContext context) {
    final e = enquiry;
    final color = _statusColor(e.status);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => onStatus('DETAILS'),
      child: NeuCard(
      shadow: AppTheme.subtle,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      e.name,
                      style: Theme.of(context).textTheme.titleSmall,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      e.referenceCode,
                      style: const TextStyle(
                        color: AppTheme.muted,
                        fontSize: 11,
                        letterSpacing: 0.2,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  _statusLabel[e.status] ?? e.status,
                  style: TextStyle(
                    color: color,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              NeuActionMenu<String>(
                iconSize: 18,
                actions: [
                  const NeuMenuAction('wa', Icons.chat_rounded, 'WhatsApp'),
                  if (e.isOpen) ...[
                    if (_canConfirm(e))
                      const NeuMenuAction('CONFIRM', Icons.event_available_rounded, 'Confirm booking')
                    else
                      const NeuMenuAction('CONVERTED', Icons.check_circle_outline_rounded, 'Mark converted'),
                    const NeuMenuAction('CLOSED', Icons.close_rounded, 'Close'),
                  ] else
                    const NeuMenuAction('NEW', Icons.replay_rounded, 'Reopen'),
                ],
                onSelected: (v) {
                  if (v == 'wa') {
                    onWhatsApp();
                  } else if (!busy) {
                    onStatus(v);
                  }
                },
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Wrap(
            spacing: AppTheme.s12,
            runSpacing: 2,
            children: [
              Text(e.phone, style: const TextStyle(fontSize: 12.5)),
              Text(
                _kindLabel[e.kind] ?? e.kind,
                style: const TextStyle(
                  color: AppTheme.accent,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                _lookingFor(e),
                style: const TextStyle(color: AppTheme.text, fontSize: 12.5),
              ),
            ],
          ),
          if ((e.notes ?? '').isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              '“${e.notes}”',
              style: const TextStyle(color: AppTheme.muted, fontSize: 12),
            ),
          ],
          const SizedBox(height: 4),
          Text(
            'Received ${formatDateTime(e.createdAt)}',
            style: const TextStyle(color: AppTheme.muted, fontSize: 11),
          ),
        ],
      ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final bool primary;
  final VoidCallback? onTap;

  const _ActionButton({
    required this.label,
    this.icon,
    this.primary = false,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final fg = primary ? Colors.white : AppTheme.accent;
    return Opacity(
      opacity: onTap == null ? 0.5 : 1,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: primary ? AppTheme.accent : Colors.transparent,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: AppTheme.accent),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 13, color: fg),
                const SizedBox(width: 4),
              ],
              Text(
                label,
                style: TextStyle(
                  color: fg,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
