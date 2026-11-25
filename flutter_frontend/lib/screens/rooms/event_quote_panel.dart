import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/dio_provider.dart';
import '../../domain/models/event_booking.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/rooms_viewmodel.dart';
import '../../widgets/compact_date_picker.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'quotation_send.dart';
import 'quote_common.dart';

/// New EVENT quotation: venue, when, guests, catering and add-ons, with the
/// server's live price underneath (the same /events/quote the function form
/// uses). Save sends only the choices; the server prices them again.
class EventQuotePanel extends ConsumerStatefulWidget {
  final VoidCallback? onSaved;

  const EventQuotePanel({super.key, this.onSaved});

  @override
  ConsumerState<EventQuotePanel> createState() => _EventQuotePanelState();
}

class _EventQuotePanelState extends ConsumerState<EventQuotePanel> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _pax = TextEditingController();
  final _plate = TextEditingController();
  final _venueCharge = TextEditingController();
  final _discount = TextEditingController();
  final _note = TextEditingController();

  int? _venueId;
  DateTime? _date;
  TimeOfDay _start = const TimeOfDay(hour: 18, minute: 0);
  TimeOfDay _end = const TimeOfDay(hour: 23, minute: 0);
  final Set<int> _addonIds = {};

  Timer? _timer;
  EventQuoteResult? _quote;
  bool _quoting = false;
  bool _saving = false;
  bool _phoneChecked = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(eventsViewModelProvider.notifier).loadCatalogue());
  }

  @override
  void dispose() {
    _timer?.cancel();
    for (final c in [_name, _phone, _pax, _plate, _venueCharge, _discount, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  DateTime? _at(TimeOfDay t, {bool next = false}) {
    final d = _date;
    if (d == null) return null;
    var at = DateTime(d.year, d.month, d.day, t.hour, t.minute);
    if (next) at = at.add(const Duration(days: 1));
    return at;
  }

  // An end time at or before the start means the function runs past midnight.
  DateTime? get _startAt => _at(_start);
  DateTime? get _endAt {
    final s = _at(_start), e = _at(_end);
    if (s == null || e == null) return null;
    return e.isAfter(s) ? e : _at(_end, next: true);
  }

  Map<String, dynamic>? _body() {
    final pax = num.tryParse(_pax.text.trim());
    if (_venueId == null || pax == null || _startAt == null) return null;
    return {
      'venueId': _venueId,
      'expectedPax': pax,
      'guaranteedPax': pax,
      'startAt': _startAt!.toUtc().toIso8601String(),
      'endAt': _endAt!.toUtc().toIso8601String(),
      if (_plate.text.trim().isNotEmpty) 'perPlateRate': num.tryParse(_plate.text.trim()) ?? 0,
      if (_venueCharge.text.trim().isNotEmpty) 'venueCharge': num.tryParse(_venueCharge.text.trim()),
      if (_discount.text.trim().isNotEmpty) 'discountAmount': num.tryParse(_discount.text.trim()),
      'addons': [for (final id in _addonIds) {'addonId': id, 'quantity': 1}],
    };
  }

  void _schedule() {
    _timer?.cancel();
    _timer = Timer(const Duration(milliseconds: 500), _refresh);
  }

  Future<void> _refresh() async {
    final body = _body();
    if (body == null) {
      setState(() => _quote = null);
      return;
    }
    setState(() => _quoting = true);
    final result = await ref.read(eventsViewModelProvider.notifier).fetchQuote(body);
    if (!mounted) return;
    setState(() {
      _quoting = false;
      _quote = result;
    });
  }

  Future<void> _pickDate(BuildContext anchor) async {
    final today = DateUtils.dateOnly(DateTime.now());
    final picked = await showAppDatePicker(
      context: context,
      anchor: anchor,
      initialDate: _date ?? today,
      firstDate: today,
      lastDate: today.add(const Duration(days: 730)),
    );
    if (picked == null) return;
    setState(() => _date = picked);
    _refresh();
  }

  Future<void> _pickTime(bool start) async {
    final picked = await showTimePicker(context: context, initialTime: start ? _start : _end);
    if (picked == null) return;
    setState(() => start ? _start = picked : _end = picked);
    _refresh();
  }

  Future<void> _save({bool whatsApp = false}) async {
    if (phoneInvalid(_phone.text)) {
      setState(() => _phoneChecked = true);
      return;
    }
    final body = _body();
    if (body == null) {
      setState(() => _error = 'Choose a venue, a date and the number of guests.');
      return;
    }
    setState(() {
      _error = null;
      _saving = true;
    });
    try {
      final saved = await ref.read(apiServiceProvider).saveKindQuotation({
        'kind': 'EVENT',
        if (_name.text.trim().isNotEmpty) 'guestName': _name.text.trim(),
        if (digitsOnly(_phone.text).isNotEmpty) 'guestPhone': digitsOnly(_phone.text),
        'event': body,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Quotation saved.'), backgroundColor: AppTheme.heading),
      );
      // Send before leaving this form: the list that follows would dispose it.
      if (whatsApp) {
        await sendSavedQuotation(ref, saved, (m) {
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m), backgroundColor: AppTheme.heading));
        });
      }
      widget.onSaved?.call();
    } catch (e) {
      if (mounted) setState(() => _error = RoomsViewModel.messageFor(e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickVenue(List<EventVenue> venues) async {
    final picked = await showDialog<int>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Choose a venue'),
        children: [
          for (final v in venues)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(ctx, v.id),
              child: Text(v.capacityPax == null ? v.name : '${v.name} · seats ${v.capacityPax}'),
            ),
        ],
      ),
    );
    if (picked == null) return;
    setState(() => _venueId = picked);
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(eventsViewModelProvider);
    final venues = state.pickableVenues();
    final addons = state.activeAddons;
    final q = _quote;
    final p = q?.pricing;
    final venue = venues.where((v) => v.id == _venueId).firstOrNull;

    final main = <Widget>[
              QuoteSection(
                icon: Icons.person_outline_rounded,
                title: 'Customer',
                hint: 'Shown under "Prepared for" on the quotation. Both are optional.',
                children: [QuoteGuestFields(name: _name, phone: _phone, showPhoneError: _phoneChecked)],
              ),
              const SizedBox(height: AppTheme.s12),
              QuoteSection(
                icon: Icons.celebration_rounded,
                title: 'Function',
                hint: 'Where and when it is held.',
                children: [
                  QuotePickField(
                    label: 'Venue',
                    value: venue == null ? null : (venue.capacityPax == null ? venue.name : '${venue.name} · seats ${venue.capacityPax}'),
                    placeholder: venues.isEmpty ? 'No venues set up' : 'Choose a venue',
                    icon: Icons.location_city_rounded,
                    onTap: venues.isEmpty ? (_) {} : (_) => _pickVenue(venues),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  QuoteRow([
                    QuotePickField(label: 'Date', value: _date == null ? null : formatDate(_date), placeholder: 'Pick a date', icon: Icons.event_rounded, onTap: _pickDate),
                    QuotePickField(label: 'Starts', value: _start.format(context), placeholder: '', icon: Icons.schedule_rounded, onTap: (_) => _pickTime(true)),
                    QuotePickField(label: 'Ends', value: _end.format(context), placeholder: '', icon: Icons.schedule_rounded, onTap: (_) => _pickTime(false)),
                  ]),
                  if (_endAt != null && _startAt != null && _endAt!.day != _startAt!.day)
                    const Padding(
                      padding: EdgeInsets.only(top: AppTheme.s8),
                      child: Text('Ends the next day, after midnight.', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                    ),
                ],
              ),
              const SizedBox(height: AppTheme.s12),
              QuoteSection(
                icon: Icons.groups_rounded,
                title: 'Guests & pricing',
                hint: 'Leave the venue charge empty to use the venue\'s own rate.',
                children: [
                  QuoteRow([
                    NeuField(controller: _pax, label: 'Guests', keyboardType: TextInputType.number, dense: true, onChanged: (_) => _schedule()),
                    NeuField(controller: _plate, label: 'Catering per plate (₹)', hint: 'Optional', keyboardType: TextInputType.number, dense: true, onChanged: (_) => _schedule()),
                  ]),
                  const SizedBox(height: AppTheme.s12),
                  QuoteRow([
                    NeuField(controller: _venueCharge, label: 'Venue charge (₹)', hint: 'Optional', keyboardType: TextInputType.number, dense: true, onChanged: (_) => _schedule()),
                    NeuField(controller: _discount, label: 'Concession (₹)', hint: 'Optional', keyboardType: TextInputType.number, dense: true, onChanged: (_) => _schedule()),
                  ]),
                ],
              ),
              if (addons.isNotEmpty) ...[
                const SizedBox(height: AppTheme.s12),
                QuoteSection(
                  icon: Icons.add_circle_outline_rounded,
                  title: 'Add-ons',
                  hint: 'Tap to include.',
                  children: [
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final a in addons)
                          FilterChip(
                            label: Text('${a.name} · ${formatPrice(a.defaultAmount)}'),
                            selected: _addonIds.contains(a.id),
                            selectedColor: AppTheme.sidebarBrandWash,
                            checkmarkColor: AppTheme.sidebarBrand,
                            onSelected: (on) {
                              setState(() => on ? _addonIds.add(a.id) : _addonIds.remove(a.id));
                              _refresh();
                            },
                          ),
                      ],
                    ),
                  ],
                ),
              ],
              const SizedBox(height: AppTheme.s12),
              QuoteSection(
                icon: Icons.sticky_note_2_outlined,
                title: 'Note',
                hint: 'Printed on the quotation.',
                children: [NeuField(controller: _note, label: '', hint: 'e.g. Advance of 25% to confirm the date', dense: true)],
              ),
    ];
    final side = <Widget>[
              QuoteSection(
                icon: Icons.receipt_long_rounded,
                title: 'Price',
                trailing: _quoting ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : null,
                children: [
                  if (q?.overCapacity != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppTheme.s8),
                      child: Text(q!.overCapacity!, style: const TextStyle(color: AppTheme.danger, fontSize: 12.5)),
                    ),
                  if (p == null)
                    const Text(
                      'Choose a venue, a date and the number of guests to see the price.',
                      style: TextStyle(color: AppTheme.muted, fontSize: 12.5),
                    )
                  else ...[
                    for (final l in p.lines)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(l.label, style: const TextStyle(fontSize: 13.5, color: AppTheme.text)),
                                  if (l.displayNote(formatPrice) != null)
                                    Text(l.displayNote(formatPrice)!, style: const TextStyle(fontSize: 11.5, color: AppTheme.muted)),
                                ],
                              ),
                            ),
                            Text(formatPrice(l.amount), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                          ],
                        ),
                      ),
                    if (p.discountAmount > 0)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Row(
                          children: [
                            const Expanded(child: Text('Concession', style: TextStyle(fontSize: 13.5, color: AppTheme.text))),
                            Text('− ${formatPrice(p.discountAmount)}', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                    const Divider(height: AppTheme.s24, color: AppTheme.sidebarBorder),
                    Row(
                      children: [
                        const Expanded(child: Text('Total', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppTheme.heading))),
                        Text(formatPrice(p.totalAmount), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20, color: AppTheme.sidebarBrand)),
                      ],
                    ),
                  ],
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: AppTheme.s8),
                Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12.5)),
              ],
              const SizedBox(height: AppTheme.s16),
              QuoteSaveButton(saving: _saving, onPressed: p == null || q?.overCapacity != null ? null : _save),
              const SizedBox(height: AppTheme.s8),
              QuoteWhatsAppButton(busy: _saving, onPressed: p == null || q?.overCapacity != null ? null : () => _save(whatsApp: true)),
    ];
    return QuoteTwoColumn(main: main, side: side);
  }
}
