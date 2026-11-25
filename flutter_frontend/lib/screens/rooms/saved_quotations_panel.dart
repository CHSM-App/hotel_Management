import 'dart:async';


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/dio_provider.dart';
import '../../domain/models/event_booking.dart';
import '../../domain/models/room.dart';
import '../../domain/models/saved_quotation.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/rooms_viewmodel.dart';
import '../../widgets/adaptive_grid.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../bar/bar_take_order_screen.dart';
import '../bookings/take_booking_screen.dart';
import '../events/event_form_screen.dart';
import '../food/counter_order_screen.dart';
import '../theme.dart';
import 'quotation_doc_pdf.dart';
import 'quotation_pdf.dart';
import 'quotation_send.dart';
import 'quote_common.dart';

/// Quotations kept from the Quotation tab. Active ones hold until their
/// earliest check-in date, then read Expired (the server decides — see
/// quotations.service.js `quotationState`). Tap one for its breakdown, PDF,
/// delete, and — while it is still active — Convert to booking.
class SavedQuotationsPanel extends ConsumerStatefulWidget {
  /// Lock the list to one kind (ROOM, EVENT, FOOD, BAR); null lists every kind
  /// in [kinds], with a chip row to narrow it.
  final String? kind;
  final List<String> kinds;

  /// The "New quotation" button — the list is the home of the module, and
  /// creating one is a step away from it.
  final VoidCallback? onNew;

  const SavedQuotationsPanel({super.key, this.kind, this.kinds = const ['ROOM'], this.onNew});

  @override
  ConsumerState<SavedQuotationsPanel> createState() => SavedQuotationsPanelState();
}

class SavedQuotationsPanelState extends ConsumerState<SavedQuotationsPanel> {
  static const _filters = [('ACTIVE', 'Active'), ('EXPIRED', 'Expired'), ('BOOKED', 'Booked'), ('ALL', 'All')];

  String _state = 'ACTIVE';
  String? _kindFilter;
  final _search = TextEditingController();
  Timer? _debounce;
  List<SavedQuotation>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> load() async {
    try {
      final items = await ref
          .read(apiServiceProvider)
          .savedQuotations(state: _state, q: _search.text, kind: widget.kind ?? _kindFilter);
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = RoomsViewModel.messageFor(e));
    }
  }

  void _say(String message) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), backgroundColor: AppTheme.heading));

  Future<void> _open(SavedQuotation summary) async {
    try {
      final full = await ref.read(apiServiceProvider).savedQuotation(summary.id);
      if (!mounted) return;
      final changed = await showModalBottomSheet<bool>(
        context: context,
        isScrollControlled: true,
        backgroundColor: AppTheme.card,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.rLarge))),
        builder: (_) => _QuotationDetail(quotation: full),
      );
      if (changed == true) load();
    } catch (e) {
      if (mounted) _say(RoomsViewModel.messageFor(e));
    }
  }

  static Color kindColor(String kind) => switch (kind) {
    'EVENT' => AppTheme.gold,
    'FOOD' => AppTheme.vacant,
    'BAR' => AppTheme.sidebarBrand,
    _ => AppTheme.accent,
  };

  static IconData kindIcon(String kind) =>
      kQuotationKinds.firstWhere((k) => k.$1 == kind, orElse: () => kQuotationKinds.first).$3;

  @override
  Widget build(BuildContext context) {
    final items = _items;
    final desktop = AppTheme.isDesktop(context);
    final newButton = FilledButton.icon(
      style: FilledButton.styleFrom(
        backgroundColor: AppTheme.sidebarBrand,
        foregroundColor: Colors.white,
        minimumSize: const Size(0, 46),
        padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
      ),
      onPressed: widget.onNew,
      icon: const Icon(Icons.add_rounded, size: 20),
      label: const Text('New quotation'),
    );
    final total = (items ?? const <SavedQuotation>[]).fold<num>(0, (sum, q) => sum + q.total);

    return Stack(
      children: [
        // Full width: the list uses the whole window, cards flow into columns.
        Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: double.infinity),
            child: RefreshIndicator(
              onRefresh: load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: EdgeInsets.fromLTRB(AppTheme.gutter(context), AppTheme.s16, AppTheme.gutter(context), 96),
                children: [
                  // Title row: what this is, and the one primary action.
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.kind == null ? 'Quotations' : '${quotationKindLabel(widget.kind!)} quotations',
                              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppTheme.heading),
                            ),
                            const Text(
                              'Prices you have quoted to customers.',
                              style: TextStyle(color: AppTheme.muted, fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                      if (desktop && widget.onNew != null) newButton,
                    ],
                  ),
                  const SizedBox(height: AppTheme.s16),
                  NeuCard(
                    radius: AppTheme.rLarge,
                    padding: const EdgeInsets.all(AppTheme.s12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        NeuField(
                          controller: _search,
                          label: '',
                          hint: 'Search by guest, phone, reference or items',
                          dense: true,
                          suffix: const Padding(padding: EdgeInsets.only(right: 8), child: Icon(Icons.search_rounded, color: AppTheme.muted, size: 20)),
                          onChanged: (_) {
                            _debounce?.cancel();
                            _debounce = Timer(const Duration(milliseconds: 350), load);
                          },
                        ),
                        const SizedBox(height: AppTheme.s12),
                        Wrap(
                          spacing: AppTheme.s24,
                          runSpacing: AppTheme.s8,
                          children: [
                        if (widget.kind == null && widget.kinds.length > 1)
                          _chipRow<String?>(
                            [
                              (null, 'All kinds'),
                              for (final k in kQuotationKinds)
                                if (widget.kinds.contains(k.$1)) (k.$1, k.$2),
                            ],
                            _kindFilter,
                            (v) {
                              setState(() {
                                _kindFilter = v;
                                _items = null;
                              });
                              load();
                            },
                          ),
                        _chipRow<String>(
                          [for (final (key, label) in _filters) (key, label)],
                          _state,
                          (v) {
                            setState(() {
                              _state = v;
                              _items = null;
                            });
                            load();
                          },
                        ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  if (items != null && items.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(4, 0, 4, AppTheme.s8),
                      child: Text(
                        '${items.length} quotation${items.length == 1 ? '' : 's'} · ${formatPrice(total)} quoted',
                        style: const TextStyle(color: AppTheme.muted, fontSize: 12.5, fontWeight: FontWeight.w600),
                      ),
                    ),
                  if (_error != null && items == null)
                    NeuNotice(icon: Icons.cloud_off_rounded, message: _error!)
                  else if (items == null)
                    const Padding(padding: EdgeInsets.all(AppTheme.s32), child: Center(child: CircularProgressIndicator()))
                  else if (items.isEmpty)
                    _empty(newButton)
                  else
                    AdaptiveGrid(minTileWidth: 440, children: [for (final q in items) _card(q)]),
                ],
              ),
            ),
          ),
        ),
        if (!desktop && widget.onNew != null)
          Positioned(
            right: AppTheme.s16,
            bottom: AppTheme.s16,
            child: FloatingActionButton.extended(
              heroTag: 'new-quotation-${widget.kind ?? 'all'}',
              backgroundColor: AppTheme.sidebarBrand,
              foregroundColor: Colors.white,
              onPressed: widget.onNew,
              icon: const Icon(Icons.add_rounded),
              label: const Text('New quotation', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
          ),
      ],
    );
  }

  Widget _chipRow<T>(List<(T, String)> options, T selected, ValueChanged<T> onSelect) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final (key, label) in options)
          ChoiceChip(
            label: Text(label),
            selected: selected == key,
            selectedColor: AppTheme.sidebarBrand,
            backgroundColor: AppTheme.card,
            side: BorderSide(color: selected == key ? AppTheme.sidebarBrand : AppTheme.border),
            labelStyle: TextStyle(
              color: selected == key ? Colors.white : AppTheme.text,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
            showCheckmark: false,
            onSelected: (_) => onSelect(key),
          ),
      ],
    );
  }

  Widget _empty(Widget newButton) {
    final filtered = _state != 'ACTIVE' || _search.text.trim().isNotEmpty || _kindFilter != null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppTheme.s32),
      child: Column(
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: const BoxDecoration(color: AppTheme.sidebarBrandWash, shape: BoxShape.circle),
            child: const Icon(Icons.request_quote_outlined, size: 34, color: AppTheme.sidebarBrand),
          ),
          const SizedBox(height: AppTheme.s16),
          Text(
            filtered ? 'No quotations match' : 'No quotations yet',
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppTheme.heading),
          ),
          const SizedBox(height: 4),
          Text(
            filtered ? 'Try another filter or search.' : 'Quote a stay, a function, a menu or a bar order and it will be kept here.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppTheme.muted, fontSize: 13),
          ),
          if (widget.onNew != null && !filtered) ...[
            const SizedBox(height: AppTheme.s16),
            newButton,
          ],
        ],
      ),
    );
  }

  Widget _card(SavedQuotation q) {
    final color = kindColor(q.kind);
    final status = _statusStyle(q.status);
    final who = (q.guestName ?? '').isNotEmpty ? q.guestName! : 'Walk-in enquiry';
    final when = q.isRoom
        ? '${formatDate(DateTime.tryParse(q.checkInDate))} → ${formatDate(DateTime.tryParse(q.lastCheckOutDate))}'
        : '${q.kind == 'EVENT' ? 'On ' : 'Valid until '}${formatDate(DateTime.tryParse(q.validUntil ?? ''))}';
    return Opacity(
      opacity: q.isExpired ? 0.7 : 1,
      child: NeuCard(
        radius: AppTheme.rLarge,
        padding: EdgeInsets.zero,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.rLarge),
          onTap: () => _open(q),
          child: Padding(
            padding: const EdgeInsets.all(AppTheme.s12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(AppTheme.rMedium)),
                  child: Icon(kindIcon(q.kind), color: color, size: 22),
                ),
                const SizedBox(width: AppTheme.s12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              who,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppTheme.heading),
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Text(formatPrice(q.total), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: AppTheme.heading)),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${quotationKindLabel(q.kind)} · ${q.referenceCode}${(q.guestPhone ?? '').isNotEmpty ? ' · ${q.guestPhone}' : ''}',
                        style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                      ),
                      const SizedBox(height: 6),
                      Text(q.roomSummary, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, color: AppTheme.text)),
                      const SizedBox(height: AppTheme.s8),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                            decoration: BoxDecoration(color: status.$3.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(status.$2, size: 14, color: status.$3),
                                const SizedBox(width: 4),
                                Text(status.$1, style: TextStyle(color: status.$3, fontSize: 12, fontWeight: FontWeight.w700)),
                              ],
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          const Icon(Icons.event_rounded, size: 14, color: AppTheme.muted),
                          const SizedBox(width: 4),
                          Expanded(child: Text(when, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: AppTheme.muted))),
                          const Icon(Icons.chevron_right_rounded, color: AppTheme.muted),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Label, icon and colour — the state is never carried by colour alone.
  (String, IconData, Color) _statusStyle(String status) => switch (status) {
    'ACTIVE' => ('Active', Icons.check_circle_outline_rounded, AppTheme.vacant),
    'BOOKED' => ('Booked', Icons.event_available_rounded, AppTheme.sidebarBrand),
    _ => ('Expired', Icons.schedule_rounded, AppTheme.muted),
  };
}

/// One saved quotation opened: the frozen breakdown per room, and what can be
/// done with it. Pops `true` when something changed (deleted, converted).
class _QuotationDetail extends ConsumerStatefulWidget {
  final SavedQuotation quotation;

  const _QuotationDetail({required this.quotation});

  @override
  ConsumerState<_QuotationDetail> createState() => _QuotationDetailState();
}

class _QuotationDetailState extends ConsumerState<_QuotationDetail> {
  bool _busy = false;

  SavedQuotation get q => widget.quotation;

  void _say(String message) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), backgroundColor: AppTheme.heading));

  /// Sends the quotation on WhatsApp — see [sendSavedQuotation].
  Future<void> _whatsApp() async {
    setState(() => _busy = true);
    try {
      await sendSavedQuotation(ref, q, _say);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _downloadDoc({bool share = false}) async {
    setState(() => _busy = true);
    try {
      final me = ref.read(authViewModelProvider).me;
      if (share) {
        await QuotationDocPdf.share(q, lodge: me?.lodge, preparedBy: me?.user.name);
      } else {
        await QuotationDocPdf.download(q, lodge: me?.lodge, preparedBy: me?.user.name);
        if (mounted) _say('Quotation saved.');
      }
    } catch (_) {
      if (mounted) _say('Could not prepare the quotation. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download() async {
    if (!q.isRoom) return _downloadDoc();
    // The letter's room facts (beds, floor…) come from the live room, so a
    // room that has since been removed cannot be re-issued.
    final rooms = ref.read(roomsViewModelProvider).rooms;
    final quoted = <QuotedRoom>[];
    for (final r in q.rooms) {
      RoomListing? room;
      for (final candidate in rooms) {
        if (candidate.id == r.roomId) room = candidate;
      }
      if (room == null) {
        _say('Room ${r.roomNumber} is no longer available, so this quotation cannot be re-issued.');
        return;
      }
      quoted.add(QuotedRoom(room: room, fromDate: r.fromDate, toDate: r.toDate, result: r.result));
    }
    setState(() => _busy = true);
    try {
      final me = ref.read(authViewModelProvider).me;
      final phone = q.guestPhone ?? '';
      await QuotationPdf.download(
        quoted,
        total: q.total,
        lodge: me?.lodge,
        guestName: q.guestName,
        guestPhone: phone.length == 10 ? '+91 ${phone.substring(0, 5)} ${phone.substring(5)}' : phone,
        preparedBy: me?.user.name,
      );
      if (mounted) _say('Quotation saved.');
    } catch (_) {
      if (mounted) _say('Could not prepare the quotation. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Delete ${q.referenceCode}?'),
        content: const Text('This removes the saved quotation. A PDF you already shared is not affected.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiServiceProvider).deleteSavedQuotation(q.id);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        _say(RoomsViewModel.messageFor(e));
      }
    }
  }

  num _n(dynamic v) => v is num ? v : num.tryParse('$v') ?? 0;

  Widget _row(String a, String b, {bool bold = false}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      children: [
        Expanded(child: Text(a, style: TextStyle(fontSize: 13, fontWeight: bold ? FontWeight.w700 : FontWeight.w400))),
        Text(b, style: TextStyle(fontSize: 13, fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
      ],
    ),
  );

  /// The frozen lines of one part (or of a whole event / food / bar quotation).
  List<Widget> _partRows(String kind, dynamic payload) {
    final rows = <Widget>[];
    if (kind == 'ROOM') {
      for (final r in (payload as List? ?? const [])) {
        final m = Map<String, dynamic>.from(r as Map);
        final res = Map<String, dynamic>.from((m['result'] as Map?) ?? const {});
        rows.add(Padding(
          padding: const EdgeInsets.only(top: 4, bottom: 2),
          child: Text(
            'Room ${m['roomNumber']}${'${m['categoryName'] ?? ''}'.isEmpty ? '' : ' · ${m['categoryName']}'} · ${formatDate(DateTime.tryParse('${m['fromDate']}'))} → ${formatDate(DateTime.tryParse('${m['toDate']}'))}',
            style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
          ),
        ));
        for (final l in (res['lines'] as List? ?? const [])) {
          final lm = Map<String, dynamic>.from(l as Map);
          rows.add(_row(lm['label']?.toString() ?? '', formatPrice(_n(lm['amount']))));
        }
        rows.add(_row('Room total', formatPrice(_n(res['total'])), bold: true));
      }
      return rows;
    }
    final d = Map<String, dynamic>.from((payload as Map?) ?? const {});
    if (kind == 'EVENT') {
      final input = Map<String, dynamic>.from((d['input'] as Map?) ?? const {});
      final p = Map<String, dynamic>.from((d['pricing'] as Map?) ?? const {});
      rows.add(Text(
        '${d['venueName'] ?? ''} · ${formatDateTime('${input['startAt']}')} → ${formatDateTime('${input['endAt']}')} · ${_n(p['billablePax']).toInt()} guests',
        style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
      ));
      rows.add(const SizedBox(height: 6));
      for (final l in (p['lines'] as List? ?? const [])) {
        final m = Map<String, dynamic>.from(l as Map);
        rows.add(_row(m['label']?.toString() ?? '', formatPrice(_n(m['amount']))));
      }
      if (_n(p['discountAmount']) > 0) rows.add(_row('Concession', '− ${formatPrice(_n(p['discountAmount']))}'));
    } else {
      for (final l in (d['lines'] as List? ?? const [])) {
        final m = Map<String, dynamic>.from(l as Map);
        rows.add(_row('${m['itemName']} × ${_n(m['quantity']).toInt()}', formatPrice(_n(m['lineTotal']))));
      }
      if (_n(d['discount']) > 0) rows.add(_row('Discount', '− ${formatPrice(_n(d['discount']))}'));
    }
    if ((d['note']?.toString() ?? '').isNotEmpty) {
      rows.add(Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text('Note: ${d['note']}', style: const TextStyle(color: AppTheme.muted, fontSize: 12.5)),
      ));
    }
    return rows;
  }

  /// The frozen breakdown of an event / food / bar quotation.
  List<Widget> _otherBody() => [..._partRows(q.kind, q.details), const Divider(height: 18, color: AppTheme.sidebarBorder)];

  /// Opens the function form (event) or an order screen (food / bar) from a
  /// frozen payload. Returns what the screen popped, and a saved event's id.
  Future<(Object?, int?)> _openOther(NavigatorState nav, String kind, Map<String, dynamic> d) async {
    if (kind == 'EVENT') {
      final input = Map<String, dynamic>.from((d['input'] as Map?) ?? const {});
      final start = DateTime.tryParse('${input['startAt']}')?.toLocal();
      final venueId = input['venueId'] is num ? (input['venueId'] as num).toInt() : null;
      final result = await nav.push(
        MaterialPageRoute(
          builder: (_) => EventFormScreen(
            initialDate: start?.toIso8601String().substring(0, 10),
            initialVenueId: venueId,
          ),
        ),
      );
      return (result, result is EventBooking ? result.id : null);
    }
    final lines = [for (final l in (d['lines'] as List? ?? const [])) Map<String, dynamic>.from(l as Map)];
    final result = await nav.push<bool>(
      MaterialPageRoute(
        builder: (_) => kind == 'BAR'
            ? BarTakeOrderScreen(
                prefillDrinks: {for (final l in lines) _n(l['menuItemId']).toInt(): _n(l['quantity']).toInt()},
                prefillName: q.guestName,
                prefillPhone: q.guestPhone,
              )
            : CounterOrderScreen(
                prefillLines: [
                  for (final l in lines)
                    (
                      itemId: _n(l['menuItemId']).toInt(),
                      portionId: l['menuItemPortionId'] == null ? null : _n(l['menuItemPortionId']).toInt(),
                      quantity: _n(l['quantity']).toInt(),
                    ),
                ],
                prefillName: q.guestName,
                prefillPhone: q.guestPhone,
              ),
      ),
    );
    return (result, null);
  }

  /// Event: the function form on the quoted venue and date. Food / bar: a new
  /// order with the quoted lines in the cart. The quotation is marked Booked
  /// once the function or order is actually saved.
  Future<void> _convertOther() async {
    final (result, refId) = await _openOther(Navigator.of(context), q.kind, q.details);
    if (result == null || result == false || !mounted) return;
    try {
      await ref.read(apiServiceProvider).markQuotationBooked(q.id, refId ?? 0, room: false);
    } catch (_) {
      // The order exists either way; the quotation just stays Active.
    }
    if (mounted) Navigator.pop(context, true);
  }

  /// Fresh pre-reservation from the quotation's guest, first room and nights.
  /// A multi-room quotation prefills its first room only — the rest stay in
  /// the quotation for the desk to add.
  Future<void> _convert() async {
    if (!q.isRoom) return _convertOther();
    final first = q.rooms.first;
    final booked = await Navigator.of(context).push<bool>(
      FullWidthRoute(
        builder: (_) => TakeBookingScreen(
          quotationId: q.id,
          prefillName: q.guestName,
          prefillPhone: q.guestPhone,
          presetRoomId: first.roomId,
          presetCheckIn: DateTime.tryParse(first.fromDate),
          presetCheckOut: DateTime.tryParse(first.toDate),
        ),
      ),
    );
    if (booked == true && mounted) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      builder: (_, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.all(AppTheme.s16),
        children: [
          Text(
            (q.guestName ?? '').isNotEmpty ? q.guestName! : 'Quotation',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppTheme.heading),
          ),
          Text(
            '${q.referenceCode}${(q.guestPhone ?? '').isNotEmpty ? ' · ${q.guestPhone}' : ''}',
            style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
          ),
          if (q.isExpired)
            Padding(
              padding: const EdgeInsets.only(top: AppTheme.s8),
              child: Text(
                q.isRoom
                    ? 'Expired — its check-in date has passed. The prices below are as quoted.'
                    : 'Expired — the prices below are as quoted and may have changed.',
                style: TextStyle(color: AppTheme.checkout, fontSize: 12.5, fontWeight: FontWeight.w600),
              ),
            ),
          const SizedBox(height: AppTheme.s12),
          if (!q.isRoom) ..._otherBody(),
          for (final r in q.rooms) ...[
            Container(
              padding: const EdgeInsets.all(AppTheme.s12),
              decoration: BoxDecoration(
                color: AppTheme.sidebarBrandWash.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(AppTheme.rMedium),
                border: Border.all(color: AppTheme.sidebarBrandWashEdge),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Room ${r.roomNumber}${r.categoryName.isEmpty ? '' : ' · ${r.categoryName}'}',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: AppTheme.heading),
                  ),
                  Text(
                    '${formatDate(DateTime.tryParse(r.fromDate))} → ${formatDate(DateTime.tryParse(r.toDate))} · ${r.result.nightCount} night${r.result.nightCount == 1 ? '' : 's'}',
                    style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
                  ),
                  const SizedBox(height: 6),
                  for (final line in r.result.lines)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        children: [
                          Expanded(child: Text(line.label, style: const TextStyle(fontSize: 13, color: AppTheme.text))),
                          Text(formatPrice(line.amount), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                        ],
                      ),
                    ),
                  const Divider(height: 14, color: AppTheme.sidebarBorder),
                  Row(
                    children: [
                      const Expanded(child: Text('Room total', style: TextStyle(fontWeight: FontWeight.w700))),
                      Text(formatPrice(r.result.total), style: const TextStyle(fontWeight: FontWeight.w800)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s8),
          ],
          Row(
            children: [
              const Expanded(child: Text('Grand total', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15))),
              Text(formatPrice(q.total), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: AppTheme.sidebarBrand)),
            ],
          ),
          const SizedBox(height: AppTheme.s16),
          if (q.isActive)
            FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: AppTheme.sidebarBrand,
                minimumSize: const Size.fromHeight(46),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
              ),
              onPressed: _busy ? null : _convert,
              icon: const Icon(Icons.event_available_rounded, size: 18),
              label: Text(q.isRoom ? 'Convert to booking' : (q.kind == 'EVENT' ? 'Convert to function' : 'Convert to order')),
            ),
          const SizedBox(height: AppTheme.s8),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(44),
              foregroundColor: const Color(0xFF128C7E),
              side: const BorderSide(color: Color(0xFF128C7E)),
            ),
            onPressed: _busy ? null : _whatsApp,
            icon: const Icon(Icons.chat_rounded, size: 18),
            label: Text((q.guestPhone ?? '').isEmpty ? 'Send on WhatsApp (choose contact)' : 'Send on WhatsApp'),
          ),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(44)),
                  onPressed: _busy ? null : _download,
                  icon: const Icon(Icons.picture_as_pdf_rounded, size: 18),
                  label: const Text('Download PDF'),
                ),
              ),
              if (!q.isRoom) ...[
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(44)),
                    onPressed: _busy ? null : () => _downloadDoc(share: true),
                    icon: const Icon(Icons.share_rounded, size: 18),
                    label: const Text('Share'),
                  ),
                ),
              ],
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(44),
                    foregroundColor: AppTheme.danger,
                    side: const BorderSide(color: AppTheme.danger),
                  ),
                  onPressed: _busy ? null : _delete,
                  icon: const Icon(Icons.delete_outline_rounded, size: 18),
                  label: const Text('Delete'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
