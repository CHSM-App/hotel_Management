import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/draft.dart';
import '../../domain/models/event_booking.dart';
import '../../domain/models/invoice.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../theme.dart';
import 'event_form_screen.dart';

const _timeline = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'SETTLED'];

/// A function's own page — mirrors EventDetail.jsx: the quote, head count,
/// extras noted on the day, the function sheet's notes, advances taken, and
/// the actions that move it through hold / confirm / settle / cancel.
class EventDetailScreen extends ConsumerStatefulWidget {
  final int eventId;

  const EventDetailScreen({super.key, required this.eventId});

  @override
  ConsumerState<EventDetailScreen> createState() => _EventDetailScreenState();
}

class _EventDetailScreenState extends ConsumerState<EventDetailScreen> {
  EventBooking? _event;
  List<AdvanceReceipt> _receipts = const [];
  bool _loading = true;
  String? _loadError;
  String? _actionError;
  bool _cancelling = false;
  final _cancelReason = TextEditingController();
  final _refundAmount = TextEditingController();
  String? _refundMethod;
  final _holdHours = TextEditingController(text: '48');

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _cancelReason.dispose();
    _refundAmount.dispose();
    _holdHours.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final vm = ref.read(eventsViewModelProvider.notifier);
    final results = await Future.wait([vm.fetchEvent(widget.eventId), vm.advanceReceipts(widget.eventId)]);
    if (!mounted) return;
    setState(() {
      _event = results[0] as EventBooking?;
      _receipts = results[1] as List<AdvanceReceipt>;
      _loading = false;
      _loadError = _event == null ? 'Could not load this function.' : null;
    });
  }

  Future<void> _run(Future<EventBooking?> Function() action) async {
    setState(() => _actionError = null);
    final result = await action();
    if (!mounted) return;
    if (result != null) {
      setState(() => _event = result);
    } else {
      setState(() => _actionError = ref.read(eventsViewModelProvider).error ?? 'Could not do that.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final ev = _event;
    return Scaffold(
      appBar: AppBar(title: Text(ev?.title ?? 'Function')),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _loadError != null
            ? Center(child: NeuNotice(icon: Icons.cloud_off_rounded, message: _loadError!))
            : ev == null
            ? const SizedBox.shrink()
            : RefreshIndicator(
                onRefresh: _load,
                color: AppTheme.accent,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, AppTheme.s24),
                  children: [
                    _Header(event: ev),
                    if (!ev.isClosed) ...[
                      const SizedBox(height: AppTheme.s12),
                      _Timeline(status: ev.status),
                    ],
                    if (ev.status == 'CANCELLED') _ClosedBanner(text: 'Cancelled${ev.cancelReason != null ? ': ${ev.cancelReason}' : ''}${(ev.refundAmount ?? 0) > 0 ? ' · Refunded ${formatPrice(ev.refundAmount)}${ev.refundPaymentMethod != null ? ' via ${kPaymentMethods[ev.refundPaymentMethod] ?? ev.refundPaymentMethod}' : ''}' : ''}'),
                    if (ev.status == 'EXPIRED') const _ClosedBanner(text: 'The hold on this date lapsed.'),
                    if (ev.status == 'TENTATIVE' && ev.holdExpiresAt != null)
                      _ClosedBanner(text: 'Hold expires ${formatDateTime(ev.holdExpiresAt)}', color: AppTheme.draft),
                    if (_actionError != null) ...[
                      const SizedBox(height: AppTheme.s8),
                      Text(_actionError!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                    ],
                    const SizedBox(height: AppTheme.s12),
                    _QuoteCard(event: ev),
                    const SizedBox(height: AppTheme.s8),
                    _HeadCountCard(event: ev),
                    const SizedBox(height: AppTheme.s8),
                    _ExtrasCard(
                      event: ev,
                      open: !ev.isClosed && ev.status != 'SETTLED',
                      onError: (m) => setState(() => _actionError = m),
                      onChanged: (updated) => setState(() => _event = updated),
                    ),
                    const SizedBox(height: AppTheme.s8),
                    _NotesCard(event: ev, onSave: (patch) => _run(() => ref.read(eventsViewModelProvider.notifier).updateEvent(ev.id, patch))),
                    const SizedBox(height: AppTheme.s8),
                    _AdvancesCard(
                      event: ev,
                      receipts: _receipts,
                      canTake: ['ENQUIRY', 'TENTATIVE', 'CONFIRMED'].contains(ev.status),
                      onTaken: _load,
                    ),
                    const SizedBox(height: AppTheme.s16),
                    if (_cancelling)
                      _CancelCard(
                        event: ev,
                        reasonController: _cancelReason,
                        refundController: _refundAmount,
                        refundMethod: _refundMethod,
                        onRefundMethodChanged: (m) => setState(() => _refundMethod = m),
                        onCancel: () async {
                          if (_cancelReason.text.trim().isEmpty) {
                            setState(() => _actionError = 'Give a reason for the cancellation.');
                            return;
                          }
                          num? refund;
                          if ((ev.advanceAmount) > 0) {
                            refund = num.tryParse(_refundAmount.text.trim());
                            if (refund == null || refund < 0) {
                              setState(() => _actionError = "Enter how much of the advance goes back — 0 keeps all of it.");
                              return;
                            }
                          } else if (_refundAmount.text.trim().isNotEmpty) {
                            refund = num.tryParse(_refundAmount.text.trim());
                          }
                          if ((refund ?? 0) > 0 && _refundMethod == null) {
                            setState(() => _actionError = 'Choose how the refund was given.');
                            return;
                          }
                          await _run(() => ref.read(eventsViewModelProvider.notifier).cancel(
                                ev.id,
                                reason: _cancelReason.text.trim(),
                                refundAmount: refund,
                                refundPaymentMethod: refund != null && refund > 0 ? _refundMethod : null,
                              ));
                          if (mounted) setState(() => _cancelling = false);
                        },
                        onKeep: () => setState(() => _cancelling = false),
                      )
                    else
                      _Actions(
                        event: ev,
                        holdHours: _holdHours,
                        onHold: () => _run(() => ref.read(eventsViewModelProvider.notifier).hold(ev.id, holdHours: int.tryParse(_holdHours.text.trim()) ?? 48)),
                        onRelease: () => _run(() => ref.read(eventsViewModelProvider.notifier).release(ev.id)),
                        onConfirm: () => _run(() => ref.read(eventsViewModelProvider.notifier).confirm(ev.id)),
                        onEdit: () async {
                          final updated = await Navigator.of(context).push<EventBooking>(
                            MaterialPageRoute(builder: (_) => EventFormScreen(event: ev)),
                          );
                          if (updated != null) setState(() => _event = updated);
                        },
                        onCancel: () {
                          _cancelReason.clear();
                          _refundAmount.text = (ev.advanceAmount) > 0 ? ev.advanceAmount.toString() : '';
                          _refundMethod = null;
                          setState(() => _cancelling = true);
                        },
                      ),
                  ],
                ),
              ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final EventBooking event;
  const _Header({required this.event});

  Color get _statusColor => switch (event.status) {
    'ENQUIRY' => const Color(0xFF5A8FD0),
    'TENTATIVE' => AppTheme.draft,
    'CONFIRMED' => const Color(0xFFC0392B),
    'SETTLED' => AppTheme.muted,
    _ => AppTheme.border,
  };

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  event.title,
                  style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 17),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: _statusColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                child: Text(kEventStatusLabel[event.status] ?? event.status, style: TextStyle(color: _statusColor, fontSize: 11, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
          Text(kEventTypeLabel[event.eventType] ?? event.eventType, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
          const SizedBox(height: 6),
          Text('${formatDateTime(event.startAt)} · ${event.venueName}${event.venueCapacity != null ? ' (up to ${event.venueCapacity})' : ''}', style: const TextStyle(color: AppTheme.text, fontSize: 13)),
          const SizedBox(height: 2),
          Text('${event.organiserName} · ${event.organiserPhone}${event.organiserAltPhone != null ? ' / ${event.organiserAltPhone}' : ''}', style: const TextStyle(color: AppTheme.text, fontSize: 13)),
        ],
      ),
    );
  }
}

class _Timeline extends StatelessWidget {
  final String status;
  const _Timeline({required this.status});

  @override
  Widget build(BuildContext context) {
    final idx = _timeline.indexOf(status);
    return Row(
      children: [
        for (var i = 0; i < _timeline.length; i++) ...[
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 6),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: i <= idx ? AppTheme.accent.withValues(alpha: i == idx ? 1 : 0.5) : AppTheme.border,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                kEventStatusLabel[_timeline[i]]!,
                style: TextStyle(color: i <= idx ? Colors.white : AppTheme.muted, fontSize: 10, fontWeight: FontWeight.w700),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          if (i < _timeline.length - 1) const SizedBox(width: 4),
        ],
      ],
    );
  }
}

class _ClosedBanner extends StatelessWidget {
  final String text;
  final Color color;
  const _ClosedBanner({required this.text, this.color = AppTheme.danger});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: AppTheme.s8),
      padding: const EdgeInsets.all(AppTheme.s8),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
      child: Text(text, style: TextStyle(color: color, fontSize: 12)),
    );
  }
}

class _QuoteCard extends StatelessWidget {
  final EventBooking event;
  const _QuoteCard({required this.event});

  @override
  Widget build(BuildContext context) {
    final lines = event.pricing?.lines ?? const [];
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Quote', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14)),
          const SizedBox(height: 6),
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Expanded(
                    child: Builder(builder: (context) {
                      final note = l.displayNote(formatPrice);
                      return Text(
                        note != null ? '${l.label} ($note)' : l.label,
                        style: const TextStyle(color: AppTheme.text, fontSize: 12),
                        overflow: TextOverflow.ellipsis,
                      );
                    }),
                  ),
                  Text(formatPrice(l.amount), style: const TextStyle(color: AppTheme.text, fontSize: 12)),
                ],
              ),
            ),
          if (event.discountAmount > 0)
            Row(
              children: [
                Expanded(child: Text('Concession${event.discountReason != null ? ' (${event.discountReason})' : ''}', style: const TextStyle(color: AppTheme.text, fontSize: 12))),
                Text('− ${formatPrice(event.discountAmount)}', style: const TextStyle(color: AppTheme.text, fontSize: 12)),
              ],
            ),
          const Divider(height: 12, color: AppTheme.border),
          _row('Total', formatPrice(event.totalAmount), bold: true),
          _row('Advance held', formatPrice(event.advanceAmount)),
          _row('Balance due', formatPrice(event.balanceDue), color: event.balanceDue > 0 ? AppTheme.danger : AppTheme.vacant),
        ],
      ),
    );
  }

  Widget _row(String label, String value, {bool bold = false, Color? color}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(color: color ?? AppTheme.text, fontWeight: bold ? FontWeight.w700 : FontWeight.w500, fontSize: bold ? 13 : 12),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Text(value, style: TextStyle(color: color ?? (bold ? AppTheme.heading : AppTheme.text), fontWeight: bold ? FontWeight.w700 : FontWeight.w500, fontSize: bold ? 13 : 12)),
      ],
    ),
  );
}

class _HeadCountCard extends StatelessWidget {
  final EventBooking event;
  const _HeadCountCard({required this.event});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Head count', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14)),
          const SizedBox(height: 6),
          _fact('Expected', '${event.expectedPax}'),
          if (event.hasCatering) ...[
            _fact('Guaranteed minimum', '${event.guaranteedPax}'),
            _fact('Final count', event.finalPax?.toString() ?? '—'),
            _fact('Billed on', '${event.billablePax} guests'),
          ] else
            const Text('No catering on this function.', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
          if (event.roomsRequired) ...[
            const SizedBox(height: 8),
            const Text('Rooms for guests', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13)),
            Text(
              '${event.roomsCount ?? ''} room(s)${event.roomsFrom != null && event.roomsTo != null ? ' · ${formatIsoDate(event.roomsFrom)} – ${formatIsoDate(event.roomsTo)}' : ''}',
              style: const TextStyle(color: AppTheme.text, fontSize: 12),
            ),
            if ((event.roomsNotes ?? '').isNotEmpty) Text(event.roomsNotes!, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
            const Text('Not booked yet — book from Bookings under the organiser\'s name.', style: TextStyle(color: AppTheme.muted, fontSize: 11)),
          ],
          const SizedBox(height: 8),
          const Text('Add-ons', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13)),
          for (final a in event.addons.where((a) => !a.isExtra))
            _fact('${a.label} × ${a.quantity}', formatPrice(a.agreedAmount ?? 0)),
          if (event.addons.where((a) => !a.isExtra).isEmpty) const Text('None.', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _fact(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(color: AppTheme.muted, fontSize: 12),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        Text(value, style: const TextStyle(color: AppTheme.text, fontSize: 12, fontWeight: FontWeight.w500)),
      ],
    ),
  );
}

class _ExtrasCard extends ConsumerStatefulWidget {
  final EventBooking event;
  final bool open;
  final ValueChanged<String> onError;
  final ValueChanged<EventBooking> onChanged;

  const _ExtrasCard({required this.event, required this.open, required this.onError, required this.onChanged});

  @override
  ConsumerState<_ExtrasCard> createState() => _ExtrasCardState();
}

class _ExtrasCardState extends ConsumerState<_ExtrasCard> {
  final _label = TextEditingController();
  final _quantity = TextEditingController(text: '1');
  final _amount = TextEditingController();
  bool _busy = false;
  final Map<int, String> _pricing = {};

  @override
  void dispose() {
    _label.dispose();
    _quantity.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    if (_label.text.trim().isEmpty) return;
    setState(() => _busy = true);
    final result = await ref.read(eventsViewModelProvider.notifier).addExtra(
      widget.event.id,
      label: _label.text.trim(),
      quantity: int.tryParse(_quantity.text.trim()) ?? 1,
      agreedAmount: _amount.text.trim().isEmpty ? null : num.tryParse(_amount.text.trim()),
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (result != null) {
      widget.onChanged(result);
      _label.clear();
      _quantity.text = '1';
      _amount.clear();
    } else {
      widget.onError(ref.read(eventsViewModelProvider).error ?? 'Could not add this extra.');
    }
  }

  Future<void> _price(EventAddonLine line) async {
    final value = _pricing[line.id];
    final amount = num.tryParse(value ?? '');
    if (amount == null) return;
    setState(() => _busy = true);
    final result = await ref.read(eventsViewModelProvider.notifier).priceExtra(widget.event.id, line.id!, amount);
    if (!mounted) return;
    setState(() => _busy = false);
    if (result != null) {
      widget.onChanged(result);
      _pricing.remove(line.id);
    } else {
      widget.onError(ref.read(eventsViewModelProvider).error ?? 'Could not set the price.');
    }
  }

  Future<void> _remove(EventAddonLine line) async {
    setState(() => _busy = true);
    final result = await ref.read(eventsViewModelProvider.notifier).removeExtra(widget.event.id, line.id!);
    if (!mounted) return;
    setState(() => _busy = false);
    if (result != null) {
      widget.onChanged(result);
    } else {
      widget.onError(ref.read(eventsViewModelProvider).error ?? 'Could not remove this extra.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final extras = widget.event.addons.where((a) => a.isExtra).toList();
    final unpriced = extras.where((a) => a.needsPricing).length;
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Extras on the day', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14)),
          if (unpriced > 0) ...[
            const SizedBox(height: 4),
            Text('$unpriced extra${unpriced == 1 ? '' : 's'} still need a price before the bill can be issued.', style: const TextStyle(color: AppTheme.draft, fontSize: 12)),
          ],
          const SizedBox(height: 6),
          if (extras.isEmpty) const Text('Nothing added on the day yet.', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
          for (final line in extras)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Expanded(child: Text('${line.label}${line.quantity > 1 ? ' × ${line.quantity}' : ''}', style: const TextStyle(color: AppTheme.text, fontSize: 12))),
                  if (line.needsPricing && widget.open) ...[
                    SizedBox(
                      width: 70,
                      child: TextField(
                        keyboardType: TextInputType.number,
                        style: const TextStyle(fontSize: 12),
                        decoration: const InputDecoration(isDense: true, hintText: '₹ agreed'),
                        onChanged: (v) => _pricing[line.id ?? 0] = v,
                      ),
                    ),
                    TextButton(onPressed: _busy ? null : () => _price(line), child: const Text('Set', style: TextStyle(fontSize: 12))),
                  ] else
                    Text(line.needsPricing ? 'price to set' : formatPrice(line.agreedAmount ?? 0), style: const TextStyle(color: AppTheme.text, fontSize: 12)),
                  if (widget.open)
                    IconButton(icon: const Icon(Icons.close_rounded, size: 16), color: AppTheme.danger, onPressed: _busy ? null : () => _remove(line)),
                ],
              ),
            ),
          if (widget.open) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(child: NeuField(controller: _label, label: '', hint: 'Extra asked for', forceCapitalizeWords: true)),
                const SizedBox(width: 6),
                SizedBox(width: 46, child: NeuField(controller: _quantity, label: '', keyboardType: TextInputType.number)),
                const SizedBox(width: 6),
                SizedBox(width: 70, child: NeuField(controller: _amount, label: '', hint: '₹', keyboardType: TextInputType.number)),
              ],
            ),
            const SizedBox(height: 6),
            NeuButton(expand: true, onPressed: _busy ? null : _add, child: const Text('Add extra')),
          ],
        ],
      ),
    );
  }
}

class _NotesCard extends StatefulWidget {
  final EventBooking event;
  final Future<void> Function(Map<String, dynamic>) onSave;

  const _NotesCard({required this.event, required this.onSave});

  @override
  State<_NotesCard> createState() => _NotesCardState();
}

class _NotesCardState extends State<_NotesCard> {
  bool _editing = false;
  late final _menu = TextEditingController(text: widget.event.menuNotes ?? '');
  late final _setup = TextEditingController(text: widget.event.setupNotes ?? '');
  late final _schedule = TextEditingController(text: widget.event.scheduleNotes ?? '');
  bool _busy = false;

  @override
  void dispose() {
    _menu.dispose();
    _setup.dispose();
    _schedule.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sections = [
      if (widget.event.hasCatering) ('menuNotes', 'Menu', _menu, widget.event.menuNotes),
      ('setupNotes', 'Setup', _setup, widget.event.setupNotes),
      ('scheduleNotes', 'Schedule', _schedule, widget.event.scheduleNotes),
    ];
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('Function sheet', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14))),
              if (!_editing)
                TextButton(onPressed: () => setState(() => _editing = true), child: const Text('Edit'))
              else
                Row(
                  children: [
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () async {
                              setState(() => _busy = true);
                              await widget.onSave({
                                'menuNotes': _menu.text.trim().isEmpty ? null : _menu.text.trim(),
                                'setupNotes': _setup.text.trim().isEmpty ? null : _setup.text.trim(),
                                'scheduleNotes': _schedule.text.trim().isEmpty ? null : _schedule.text.trim(),
                              });
                              if (mounted) {
                                setState(() {
                                  _busy = false;
                                  _editing = false;
                                });
                              }
                            },
                      child: const Text('Save'),
                    ),
                    TextButton(onPressed: _busy ? null : () => setState(() => _editing = false), child: const Text('Cancel')),
                  ],
                ),
            ],
          ),
          for (final s in sections)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.$2, style: const TextStyle(color: AppTheme.muted, fontSize: 11, fontWeight: FontWeight.w600)),
                  if (_editing)
                    NeuField(controller: s.$3, label: '')
                  else
                    Text(s.$4?.isNotEmpty == true ? s.$4! : 'Nothing noted.', style: const TextStyle(color: AppTheme.text, fontSize: 12)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _AdvancesCard extends StatefulWidget {
  final EventBooking event;
  final List<AdvanceReceipt> receipts;
  final bool canTake;
  final VoidCallback onTaken;

  const _AdvancesCard({required this.event, required this.receipts, required this.canTake, required this.onTaken});

  @override
  State<_AdvancesCard> createState() => _AdvancesCardState();
}

class _AdvancesCardState extends State<_AdvancesCard> {
  bool _taking = false;

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('Advances', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14))),
              if (widget.canTake && !_taking)
                TextButton(onPressed: () => setState(() => _taking = true), child: const Text('Take advance')),
            ],
          ),
          if (widget.receipts.isEmpty) const Text('No advance taken yet.', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
          for (final r in widget.receipts)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${r.receiptNumber ?? '#${r.id}'} · ${formatIsoDate(r.createdAt)}${r.isVoid ? ' · void' : ''}',
                      style: const TextStyle(color: AppTheme.text, fontSize: 12),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text('${formatPrice(r.amountReceived)}${r.paymentMethod != null ? ' · ${r.paymentMethod}' : ''}', style: const TextStyle(color: AppTheme.text, fontSize: 12)),
                ],
              ),
            ),
          if (widget.event.invoice != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('Invoice ${widget.event.invoice!.invoiceNumber ?? ''} · ${formatPrice(widget.event.invoice!.totalAmount)}', style: const TextStyle(color: AppTheme.text, fontSize: 12)),
            ),
          if (_taking)
            _TakeAdvanceForm(
              event: widget.event,
              onDone: () {
                setState(() => _taking = false);
                widget.onTaken();
              },
              onCancel: () => setState(() => _taking = false),
            ),
        ],
      ),
    );
  }
}

class _TakeAdvanceForm extends ConsumerStatefulWidget {
  final EventBooking event;
  final VoidCallback onDone;
  final VoidCallback onCancel;

  const _TakeAdvanceForm({required this.event, required this.onDone, required this.onCancel});

  @override
  ConsumerState<_TakeAdvanceForm> createState() => _TakeAdvanceFormState();
}

class _TakeAdvanceFormState extends ConsumerState<_TakeAdvanceForm> {
  final List<PaymentDraft> _lines = [PaymentDraft()];
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    final paid = _lines.where((l) => l.value > 0).toList();
    if (paid.isEmpty) return;
    final problem = paymentLinesError(paid);
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final body = <String, dynamic>{
      'amountReceived': sumPayments(paid),
      if (paid.length == 1) 'paymentMethod': paid.first.method,
      if (paid.length == 1 && needsPaymentReference(paid.first.method) && paid.first.reference.trim().isNotEmpty) 'paymentReference': paid.first.reference.trim(),
      if (paid.length > 1) 'paymentLines': paid.map((l) => l.toJson()).toList(),
    };
    final receipt = await ref.read(eventsViewModelProvider.notifier).issueAdvanceReceipt(widget.event.id, body);
    if (!mounted) return;
    if (receipt != null) {
      widget.onDone();
    } else {
      setState(() {
        _busy = false;
        _error = ref.read(eventsViewModelProvider).error ?? 'Could not record this advance.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppTheme.s8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < _lines.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.s8),
              child: PaymentRow(
                key: ValueKey(_lines[i]),
                line: _lines[i],
                onRemove: _lines.length == 1 ? null : () => setState(() => _lines.removeAt(i)),
                onChanged: () => setState(() {}),
              ),
            ),
          if (_lines.length < 5)
            NeuButton(expand: true, onPressed: () => setState(() => _lines.add(PaymentDraft())), child: const Text('+ Add another payment')),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12))),
          const SizedBox(height: AppTheme.s8),
          Row(
            children: [
              Expanded(child: NeuButton(onPressed: _busy ? null : widget.onCancel, child: const Text('Cancel'))),
              const SizedBox(width: AppTheme.s8),
              Expanded(child: NeuButton(primary: true, onPressed: _busy ? null : _submit, child: Text(_busy ? 'Recording…' : 'Record'))),
            ],
          ),
        ],
      ),
    );
  }
}

class _CancelCard extends StatelessWidget {
  final EventBooking event;
  final TextEditingController reasonController;
  final TextEditingController refundController;
  final String? refundMethod;
  final ValueChanged<String?> onRefundMethodChanged;
  final VoidCallback onCancel;
  final VoidCallback onKeep;

  const _CancelCard({
    required this.event,
    required this.reasonController,
    required this.refundController,
    required this.refundMethod,
    required this.onRefundMethodChanged,
    required this.onCancel,
    required this.onKeep,
  });

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Cancel this function', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14)),
          const SizedBox(height: AppTheme.s8),
          NeuField(controller: reasonController, label: 'Reason', required: true),
          if (event.advanceAmount > 0) ...[
            const SizedBox(height: AppTheme.s8),
            Text('An advance of ${formatPrice(event.advanceAmount)} is held. Whatever is not refunded is kept as a cancellation charge.', style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: refundController, label: 'Refund to organiser', keyboardType: TextInputType.number),
            const SizedBox(height: AppTheme.s8),
            Text('Refunded via', style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
            const SizedBox(height: 4),
            NeuPressed(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: refundMethod,
                  isExpanded: true,
                  dropdownColor: AppTheme.bg,
                  hint: const Text('Choose type', style: TextStyle(color: AppTheme.muted, fontSize: 13)),
                  items: [
                    for (final e in kPaymentMethods.entries)
                      DropdownMenuItem(value: e.key, child: Text(e.value)),
                  ],
                  onChanged: onRefundMethodChanged,
                ),
              ),
            ),
          ],
          const SizedBox(height: AppTheme.s12),
          Row(
            children: [
              Expanded(child: NeuButton(onPressed: onKeep, child: const Text('Keep it'))),
              const SizedBox(width: AppTheme.s8),
              Expanded(child: NeuButton(primary: true, color: AppTheme.danger, onPressed: onCancel, child: const Text('Cancel function'))),
            ],
          ),
        ],
      ),
    );
  }
}

class _Actions extends StatelessWidget {
  final EventBooking event;
  final TextEditingController holdHours;
  final VoidCallback onHold;
  final VoidCallback onRelease;
  final VoidCallback onConfirm;
  final VoidCallback onEdit;
  final VoidCallback onCancel;

  const _Actions({
    required this.event,
    required this.holdHours,
    required this.onHold,
    required this.onRelease,
    required this.onConfirm,
    required this.onEdit,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    final status = event.status;
    final closed = event.isClosed;
    final canEdit = ['ENQUIRY', 'TENTATIVE', 'CONFIRMED', 'EXPIRED'].contains(status);

    return Wrap(
      spacing: AppTheme.s8,
      runSpacing: AppTheme.s8,
      children: [
        if (status == 'ENQUIRY' || status == 'EXPIRED') ...[
          SizedBox(
            width: 70,
            child: NeuField(controller: holdHours, label: '', keyboardType: TextInputType.number),
          ),
          NeuButton(onPressed: onHold, child: Text(status == 'EXPIRED' ? 'Hold again' : 'Hold date')),
        ],
        if (status == 'TENTATIVE') NeuButton(onPressed: onRelease, child: const Text('Release hold')),
        if (['ENQUIRY', 'TENTATIVE', 'EXPIRED'].contains(status)) NeuButton(primary: true, onPressed: onConfirm, child: const Text('Confirm')),
        if (canEdit && status != 'EXPIRED') NeuButton(onPressed: onEdit, child: const Text('Edit')),
        if (!closed && status != 'SETTLED') NeuButton(color: AppTheme.danger, primary: true, onPressed: onCancel, child: const Text('Cancel event')),
      ],
    );
  }
}
