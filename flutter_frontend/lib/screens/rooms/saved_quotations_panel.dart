import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/room.dart';
import '../../domain/models/saved_quotation.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/rooms_viewmodel.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../bookings/take_booking_screen.dart';
import '../theme.dart';
import 'quotation_pdf.dart';

/// Quotations kept from the Quotation tab. Active ones hold until their
/// earliest check-in date, then read Expired (the server decides — see
/// quotations.service.js `quotationState`). Tap one for its breakdown, PDF,
/// delete, and — while it is still active — Convert to booking.
class SavedQuotationsPanel extends ConsumerStatefulWidget {
  const SavedQuotationsPanel({super.key});

  @override
  ConsumerState<SavedQuotationsPanel> createState() => SavedQuotationsPanelState();
}

class SavedQuotationsPanelState extends ConsumerState<SavedQuotationsPanel> {
  static const _filters = [('ACTIVE', 'Active'), ('EXPIRED', 'Expired'), ('BOOKED', 'Booked'), ('ALL', 'All')];

  String _state = 'ACTIVE';
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
      final items = await ref.read(roomsViewModelProvider.notifier).savedQuotations(state: _state, q: _search.text);
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

  Color _stateColor(String status) => switch (status) {
    'ACTIVE' => AppTheme.vacant,
    'BOOKED' => AppTheme.sidebarBrand,
    _ => AppTheme.muted,
  };

  Future<void> _open(SavedQuotation summary) async {
    final vm = ref.read(roomsViewModelProvider.notifier);
    try {
      final full = await vm.savedQuotation(summary.id);
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

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: AppTheme.formMaxWidth(context)),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, AppTheme.s8),
              child: Column(
                children: [
                  NeuField(
                    controller: _search,
                    label: 'Search guest, phone or reference',
                    onChanged: (_) {
                      _debounce?.cancel();
                      _debounce = Timer(const Duration(milliseconds: 350), load);
                    },
                  ),
                  const SizedBox(height: AppTheme.s8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Wrap(
                      spacing: 8,
                      children: [
                        for (final (key, label) in _filters)
                          ChoiceChip(
                            label: Text(label),
                            selected: _state == key,
                            selectedColor: AppTheme.sidebarBrand,
                            labelStyle: TextStyle(
                              color: _state == key ? Colors.white : AppTheme.text,
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                            showCheckmark: false,
                            onSelected: (_) {
                              setState(() {
                                _state = key;
                                _items = null;
                              });
                              load();
                            },
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: load,
                child: _error != null && items == null
                    ? ListView(children: [NeuNotice(icon: Icons.cloud_off_rounded, message: _error!)])
                    : items == null
                    ? const Center(child: CircularProgressIndicator())
                    : items.isEmpty
                    ? ListView(
                        children: [
                          NeuNotice(
                            icon: Icons.request_quote_outlined,
                            message: _state == 'ACTIVE'
                                ? 'No active quotations.\nPrice a stay and tap "Save quotation".'
                                : 'Nothing here.',
                          ),
                        ],
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.fromLTRB(AppTheme.s12, 0, AppTheme.s12, AppTheme.s24),
                        itemCount: items.length,
                        separatorBuilder: (_, _) => const SizedBox(height: AppTheme.s8),
                        itemBuilder: (_, i) => _card(items[i]),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _card(SavedQuotation q) {
    final color = _stateColor(q.status);
    final who = (q.guestName ?? '').isNotEmpty ? q.guestName! : 'Walk-in enquiry';
    return Opacity(
      opacity: q.isExpired ? 0.65 : 1,
      child: NeuCard(
        radius: AppTheme.rLarge,
        padding: EdgeInsets.zero,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.rLarge),
          onTap: () => _open(q),
          child: Padding(
            padding: const EdgeInsets.all(AppTheme.s12),
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
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, color: AppTheme.heading),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                      child: Text(
                        q.isActive ? 'Active' : (q.isBooked ? 'Booked' : 'Expired'),
                        style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${q.referenceCode}${(q.guestPhone ?? '').isNotEmpty ? ' · ${q.guestPhone}' : ''}',
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12),
                ),
                const SizedBox(height: 6),
                Text(q.roomSummary, style: const TextStyle(fontSize: 13, color: AppTheme.text)),
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.event_rounded, size: 14, color: AppTheme.muted),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        '${formatDate(DateTime.tryParse(q.checkInDate))} → ${formatDate(DateTime.tryParse(q.lastCheckOutDate))}',
                        style: const TextStyle(fontSize: 12.5, color: AppTheme.muted),
                      ),
                    ),
                    Text(
                      formatPrice(q.total),
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppTheme.heading),
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

  Future<void> _download() async {
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
      await ref.read(roomsViewModelProvider.notifier).deleteSavedQuotation(q.id);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        _say(RoomsViewModel.messageFor(e));
      }
    }
  }

  /// Fresh pre-reservation from the quotation's guest, first room and nights.
  /// A multi-room quotation prefills its first room only — the rest stay in
  /// the quotation for the desk to add.
  Future<void> _convert() async {
    final first = q.rooms.first;
    final booked = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
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
                'Expired — its check-in date has arrived. The prices below are as quoted.',
                style: TextStyle(color: AppTheme.checkout, fontSize: 12.5, fontWeight: FontWeight.w600),
              ),
            ),
          const SizedBox(height: AppTheme.s12),
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
              label: const Text('Convert to booking'),
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
