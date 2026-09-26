import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/draft.dart';
import '../../domain/models/event_booking.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/payment_row.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

const _debounce = Duration(milliseconds: 400);

/// New enquiry / edit — mirrors EventForm.jsx: function details, organiser,
/// guests & pricing (with a live quote), catering, rooms wanted, add-ons, a
/// concession, the function sheet's own notes, and — new functions only —
/// money taken with the enquiry.
class EventFormScreen extends ConsumerStatefulWidget {
  final EventBooking? event;
  final String? initialDate;
  final int? initialVenueId;

  const EventFormScreen({super.key, this.event, this.initialDate, this.initialVenueId});

  @override
  ConsumerState<EventFormScreen> createState() => _EventFormScreenState();
}

class _EventFormScreenState extends ConsumerState<EventFormScreen> {
  bool get _isEdit => widget.event != null;

  late String _eventType = widget.event?.eventType ?? 'BIRTHDAY';
  int? _venueId;
  late String _slot = widget.event?.slot ?? 'EVENING';
  late DateTime _startDate;
  late TimeOfDay _startTime;
  late DateTime _endDate;
  late TimeOfDay _endTime;

  late final _title = TextEditingController(text: widget.event?.title ?? '');
  late final _organiserName = TextEditingController(text: widget.event?.organiserName ?? '');
  late final _organiserPhone = TextEditingController(text: widget.event?.organiserPhone ?? '');
  late final _organiserAltPhone = TextEditingController(text: widget.event?.organiserAltPhone ?? '');
  late final _expectedPax = TextEditingController(text: widget.event?.expectedPax == null || widget.event!.expectedPax == 0 ? '' : widget.event!.expectedPax.toString());
  late final _venueCharge = TextEditingController(text: widget.event?.venueCharge == null ? '' : widget.event!.venueCharge.toString());
  late bool _catering = (widget.event?.perPlateRate ?? 0) > 0;
  late final _perPlateRate = TextEditingController(text: (widget.event?.perPlateRate ?? 0) > 0 ? widget.event!.perPlateRate.toString() : '');
  late final _guaranteedPax = TextEditingController(text: widget.event?.guaranteedPax == null || widget.event!.guaranteedPax == 0 ? '' : widget.event!.guaranteedPax.toString());
  late bool _roomsRequired = widget.event?.roomsRequired ?? false;
  late final _roomsCount = TextEditingController(text: widget.event?.roomsCount?.toString() ?? '');
  DateTime? _roomsFrom;
  DateTime? _roomsTo;
  late final _roomsNotes = TextEditingController(text: widget.event?.roomsNotes ?? '');
  late final _discountAmount = TextEditingController(text: (widget.event?.discountAmount ?? 0) > 0 ? widget.event!.discountAmount.toString() : '');
  late final _discountReason = TextEditingController(text: widget.event?.discountReason ?? '');
  late final _menuNotes = TextEditingController(text: widget.event?.menuNotes ?? '');
  late final _setupNotes = TextEditingController(text: widget.event?.setupNotes ?? '');
  late final _scheduleNotes = TextEditingController(text: widget.event?.scheduleNotes ?? '');
  late final _oneOffLabel = TextEditingController();
  late final _oneOffAmount = TextEditingController();
  late final _holdHours = TextEditingController(text: '48');

  /// One line per catalogue add-on plus any one-off already saved on the
  /// booking — mirrors initialLines in EventForm.jsx.
  late List<_AddonLineDraft> _lines = [];

  final List<PaymentDraft> _advanceLines = [PaymentDraft()];

  Timer? _quoteTimer;
  EventQuoteResult? _quote;
  String? _quoteError;
  bool _quoting = false;

  EventAvailability? _availability;
  bool _checkingAvailability = false;

  String? _error;
  String? _fieldError;
  bool _submitAttempted = false;
  bool _catalogueReady = false;

  final _scrollController = ScrollController();
  final Map<String, GlobalKey> _fieldKeys = {
    for (final k in ['title', 'venue', 'end', 'organiserName', 'organiserPhone', 'expectedPax', 'perPlateRate', 'roomsCount', 'roomsFrom', 'roomsTo', 'advance'])
      k: GlobalKey(),
  };

  @override
  void initState() {
    super.initState();
    final ev = widget.event;
    if (ev != null) {
      final start = DateTime.tryParse(ev.startAt)?.toLocal() ?? DateTime.now();
      final end = DateTime.tryParse(ev.endAt)?.toLocal() ?? start.add(const Duration(hours: 2));
      _startDate = DateTime(start.year, start.month, start.day);
      _startTime = TimeOfDay(hour: start.hour, minute: start.minute);
      _endDate = DateTime(end.year, end.month, end.day);
      _endTime = TimeOfDay(hour: end.hour, minute: end.minute);
      _venueId = ev.venueId;
      if (ev.roomsFrom != null) _roomsFrom = DateTime.tryParse(ev.roomsFrom!);
      if (ev.roomsTo != null) _roomsTo = DateTime.tryParse(ev.roomsTo!);
    } else {
      final date = widget.initialDate != null ? DateTime.tryParse(widget.initialDate!) : null;
      final base = date ?? DateTime.now();
      _startDate = DateTime(base.year, base.month, base.day);
      _endDate = _startDate;
      final hours = kSlotHours['EVENING']!;
      _startTime = _parseTime(hours[0]);
      _endTime = _parseTime(hours[1]);
      _venueId = widget.initialVenueId;
    }

    Future.microtask(() async {
      final vm = ref.read(eventsViewModelProvider.notifier);
      if (ref.read(eventsViewModelProvider).venues.isEmpty || ref.read(eventsViewModelProvider).addons.isEmpty) {
        await vm.loadCatalogue();
      }
      if (!mounted) return;
      final state = ref.read(eventsViewModelProvider);
      setState(() {
        _venueId ??= state.pickableVenues().firstOrNull?.id;
        _lines = _initialLines(state.addons);
        _catalogueReady = true;
      });
      _refreshQuote();
      _checkAvailability();
    });
  }

  static TimeOfDay _parseTime(String hhmm) {
    final parts = hhmm.split(':');
    return TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1]));
  }

  List<_AddonLineDraft> _initialLines(List<EventAddon> addons) {
    final ev = widget.event;
    final lines = addons.where((a) => a.isActive || (ev?.addons.any((x) => x.addonId == a.id) ?? false)).map((a) {
      final saved = ev?.addons.firstWhereOrNull((x) => x.addonId == a.id);
      return _AddonLineDraft(
        addonId: a.id,
        label: a.name,
        unitAmount: a.defaultAmount,
        quantity: saved?.quantity ?? 1,
        agreedAmount: saved?.agreedAmount?.toString(),
        selected: saved != null,
      );
    }).toList();
    if (ev != null) {
      for (final saved in ev.addons) {
        if (saved.addonId != null && lines.any((l) => l.addonId == saved.addonId)) continue;
        lines.add(_AddonLineDraft(
          label: saved.label,
          quantity: saved.quantity,
          agreedAmount: saved.agreedAmount?.toString(),
          selected: true,
          isExtra: saved.isExtra,
          needsPricing: saved.needsPricing,
          notedAt: saved.notedAt,
        ));
      }
    }
    return lines;
  }

  @override
  void dispose() {
    _quoteTimer?.cancel();
    _scrollController.dispose();
    _title.dispose();
    _organiserName.dispose();
    _organiserPhone.dispose();
    _organiserAltPhone.dispose();
    _expectedPax.dispose();
    _venueCharge.dispose();
    _perPlateRate.dispose();
    _guaranteedPax.dispose();
    _roomsCount.dispose();
    _roomsNotes.dispose();
    _discountAmount.dispose();
    _discountReason.dispose();
    _menuNotes.dispose();
    _setupNotes.dispose();
    _scheduleNotes.dispose();
    _oneOffLabel.dispose();
    _oneOffAmount.dispose();
    _holdHours.dispose();
    super.dispose();
  }

  EventVenue? get _venue {
    final id = _venueId;
    if (id == null) return null;
    final venues = ref.read(eventsViewModelProvider).venues;
    return venues.firstWhereOrNull((v) => v.id == id);
  }

  DateTime get _startAt => DateTime(_startDate.year, _startDate.month, _startDate.day, _startTime.hour, _startTime.minute);
  DateTime get _endAt => DateTime(_endDate.year, _endDate.month, _endDate.day, _endTime.hour, _endTime.minute);

  num get _advanceAmount => _isEdit ? 0 : sumPayments(_advanceLines);

  List<Map<String, dynamic>> get _addonPayload => [
    for (final l in _lines.where((l) => l.selected))
      {
        if (l.addonId != null) 'addonId': l.addonId,
        if (l.addonId == null) 'label': l.label,
        'quantity': l.quantity,
        if (l.agreedAmount != null && l.agreedAmount!.isNotEmpty) 'agreedAmount': num.tryParse(l.agreedAmount!),
      },
  ];

  void _scheduleQuote() {
    _quoteTimer?.cancel();
    _quoteTimer = Timer(_debounce, _refreshQuote);
  }

  Future<void> _refreshQuote() async {
    final venueId = _venueId;
    final pax = num.tryParse(_expectedPax.text.trim());
    if (venueId == null || pax == null) {
      setState(() => _quote = null);
      return;
    }
    if (_catering && (_perPlateRate.text.trim().isEmpty)) {
      setState(() => _quote = null);
      return;
    }
    setState(() => _quoting = true);
    final body = {
      'venueId': venueId,
      'expectedPax': pax,
      'guaranteedPax': _catering ? (num.tryParse(_guaranteedPax.text.trim()) ?? pax) : pax,
      if (widget.event?.finalPax != null) 'finalPax': widget.event!.finalPax,
      if (_venueCharge.text.trim().isNotEmpty) 'venueCharge': num.tryParse(_venueCharge.text.trim()),
      'perPlateRate': _catering ? (num.tryParse(_perPlateRate.text.trim()) ?? 0) : 0,
      'addons': _addonPayload,
      if (_discountAmount.text.trim().isNotEmpty) 'discountAmount': num.tryParse(_discountAmount.text.trim()),
    };
    final result = await ref.read(eventsViewModelProvider.notifier).fetchQuote(body);
    if (!mounted) return;
    setState(() {
      _quoting = false;
      _quote = result;
      _quoteError = result == null ? 'Could not price this function.' : null;
    });
  }

  Future<void> _checkAvailability() async {
    final venueId = _venueId;
    if (venueId == null) {
      setState(() => _availability = null);
      return;
    }
    setState(() => _checkingAvailability = true);
    final result = await ref.read(eventsViewModelProvider.notifier).checkAvailability(
      venueId: venueId,
      startAt: _startAt.toIso8601String(),
      endAt: _endAt.toIso8601String(),
      excludeId: widget.event?.id,
    );
    if (!mounted) return;
    setState(() {
      _checkingAvailability = false;
      _availability = result;
    });
  }

  void _pickSlot(String slot) {
    setState(() {
      _slot = slot;
      final hours = kSlotHours[slot];
      if (hours != null) {
        _startTime = _parseTime(hours[0]);
        _endTime = _parseTime(hours[1]);
        _endDate = _startDate;
      }
    });
    _checkAvailability();
  }

  Future<void> _pickDate({required bool isStart}) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final picked = await showDatePicker(
      context: context,
      // An event can't end before it starts, so the end calendar starts there.
      firstDate: isStart
          ? (_isEdit ? today.subtract(const Duration(days: 3650)) : today)
          : _startDate,
      lastDate: today.add(const Duration(days: 730)),
      initialDate: isStart ? _startDate : _endDate,
      helpText: isStart ? 'Starts' : 'Ends',
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _startDate = picked;
        if (_endDate.isBefore(_startDate)) _endDate = _startDate;
      } else {
        _endDate = picked;
      }
      _slot = 'CUSTOM';
    });
    _checkAvailability();
    _refreshQuote();
  }

  Future<void> _pickTime({required bool isStart}) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: isStart ? _startTime : _endTime,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        _startTime = picked;
      } else {
        _endTime = picked;
      }
      _slot = 'CUSTOM';
    });
    _checkAvailability();
  }

  Future<void> _pickRoomsDate({required bool isFrom}) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final firstDate = isFrom
        ? today.subtract(const Duration(days: 365))
        : (_roomsFrom ?? today.subtract(const Duration(days: 365)));
    var initialDate = (isFrom ? _roomsFrom : _roomsTo) ?? _startDate;
    if (initialDate.isBefore(firstDate)) initialDate = firstDate;
    final picked = await showDatePicker(
      context: context,
      firstDate: firstDate,
      lastDate: today.add(const Duration(days: 730)),
      initialDate: initialDate,
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _roomsFrom = picked;
        if (_roomsTo == null || !_roomsTo!.isAfter(picked)) _roomsTo = picked.add(const Duration(days: 1));
      } else {
        _roomsTo = picked;
      }
    });
  }

  void _toggleRooms(bool on) {
    setState(() {
      _roomsRequired = on;
      if (on) {
        _roomsFrom ??= _startDate;
        _roomsTo ??= _endDate.add(const Duration(days: 1));
      }
    });
  }

  void _addOneOff() {
    if (_oneOffLabel.text.trim().isEmpty) return;
    setState(() {
      _lines.add(_AddonLineDraft(
        label: _oneOffLabel.text.trim(),
        quantity: 1,
        agreedAmount: _oneOffAmount.text.trim().isEmpty ? null : _oneOffAmount.text.trim(),
        selected: true,
      ));
      _oneOffLabel.clear();
      _oneOffAmount.clear();
    });
    _scheduleQuote();
  }

  (String, String)? _firstInvalid() {
    if (_title.text.trim().isEmpty) return ('title', 'Give the function a title.');
    if (_venueId == null) return ('venue', 'Pick a venue.');
    if (!_endAt.isAfter(_startAt)) return ('end', 'The function has to end after it starts.');
    if (_organiserName.text.trim().isEmpty) return ('organiserName', "Who is organising it?");
    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(_organiserPhone.text.trim())) return ('organiserPhone', 'Enter a valid 10-digit mobile number.');
    final pax = num.tryParse(_expectedPax.text.trim());
    if (pax == null || pax <= 0) return ('expectedPax', 'How many guests are expected?');
    final venue = _venue;
    final guaranteed = _catering ? (num.tryParse(_guaranteedPax.text.trim()) ?? 0) : 0;
    final seated = pax > guaranteed ? pax : guaranteed;
    if (venue?.capacityPax != null && seated > venue!.capacityPax!) {
      return ('expectedPax', '${venue.name} seats ${venue.capacityPax}. Lower the count, or pick a larger venue.');
    }
    if (_catering && !((num.tryParse(_perPlateRate.text.trim()) ?? 0) > 0)) {
      return ('perPlateRate', 'Enter the per-plate rate.');
    }
    if (_roomsRequired) {
      if (!((int.tryParse(_roomsCount.text.trim()) ?? 0) >= 1)) return ('roomsCount', 'How many rooms are needed?');
      if (_roomsFrom == null) return ('roomsFrom', 'Choose the night the rooms are needed from.');
      if (_roomsTo == null || !_roomsTo!.isAfter(_roomsFrom!)) return ('roomsTo', 'The rooms have to be needed for at least one night.');
    }
    if (!_isEdit) {
      final touched = _advanceLines.any((l) => l.method != null || l.amount.isNotEmpty || l.reference.isNotEmpty);
      if (touched) {
        final problem = paymentLinesError(_advanceLines);
        if (problem != null) return ('advance', problem);
      }
    }
    return null;
  }

  Map<String, dynamic> _body() {
    final pax = num.tryParse(_expectedPax.text.trim()) ?? 0;
    return {
      'eventType': _eventType,
      'title': _title.text.trim(),
      'venueId': _venueId,
      'slot': _slot,
      'startAt': _startAt.toIso8601String(),
      'endAt': _endAt.toIso8601String(),
      'organiserName': _organiserName.text.trim(),
      'organiserPhone': _organiserPhone.text.trim(),
      if (_organiserAltPhone.text.trim().isNotEmpty) 'organiserAltPhone': _organiserAltPhone.text.trim(),
      'expectedPax': pax,
      'guaranteedPax': _catering ? (num.tryParse(_guaranteedPax.text.trim()) ?? pax) : pax,
      'perPlateRate': _catering ? (num.tryParse(_perPlateRate.text.trim()) ?? 0) : 0,
      if (_venueCharge.text.trim().isNotEmpty) 'venueCharge': num.tryParse(_venueCharge.text.trim()),
      'addons': _addonPayload,
      'discountAmount': num.tryParse(_discountAmount.text.trim()) ?? 0,
      if (_discountReason.text.trim().isNotEmpty) 'discountReason': _discountReason.text.trim(),
      if (_catering) 'menuNotes': _menuNotes.text.trim().isEmpty ? null : _menuNotes.text.trim(),
      'setupNotes': _setupNotes.text.trim().isEmpty ? null : _setupNotes.text.trim(),
      'scheduleNotes': _scheduleNotes.text.trim().isEmpty ? null : _scheduleNotes.text.trim(),
      'roomsRequired': _roomsRequired,
      if (_roomsRequired) 'roomsCount': int.tryParse(_roomsCount.text.trim()),
      if (_roomsRequired && _roomsFrom != null) 'roomsFrom': _dateKey(_roomsFrom!),
      if (_roomsRequired && _roomsTo != null) 'roomsTo': _dateKey(_roomsTo!),
      if (_roomsRequired) 'roomsNotes': _roomsNotes.text.trim().isEmpty ? null : _roomsNotes.text.trim(),
    };
  }

  static String _dateKey(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _save({String? status}) async {
    setState(() => _submitAttempted = true);
    final invalid = _firstInvalid();
    if (invalid != null) {
      setState(() {
        _fieldError = invalid.$1;
        _error = invalid.$2;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final key = _fieldKeys[invalid.$1];
        final ctx = key?.currentContext;
        if (ctx != null) {
          Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 250), alignment: 0.2);
        } else {
          _scrollController.animateTo(0, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
        }
      });
      return;
    }
    setState(() {
      _error = null;
      _fieldError = null;
    });

    final body = _body();
    if (!_isEdit) {
      body['status'] = status ?? 'ENQUIRY';
      if (status == 'TENTATIVE') body['holdHours'] = int.tryParse(_holdHours.text.trim()) ?? 48;
      final amount = _advanceAmount;
      if (amount > 0) {
        body['advanceAmount'] = amount;
        body['advancePaymentMethod'] = _advanceLines.first.method;
        if (needsPaymentReference(_advanceLines.first.method) && _advanceLines.first.reference.trim().isNotEmpty) {
          body['advanceReference'] = _advanceLines.first.reference.trim();
        }
        if (_advanceLines.length > 1) {
          body['advanceLines'] = _advanceLines.where((l) => l.value > 0).map((l) => l.toJson()).toList();
        }
      }
    }

    final vm = ref.read(eventsViewModelProvider.notifier);
    final result = _isEdit ? await vm.updateEvent(widget.event!.id, body) : await vm.createEvent(body);
    if (!mounted) return;
    if (result != null) {
      Navigator.of(context).pop(result);
    } else {
      setState(() => _error = ref.read(eventsViewModelProvider).error ?? 'Could not save this function.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(eventsViewModelProvider);
    final me = ref.watch(authViewModelProvider).me;
    final canCater = me?.lodge.servesFood ?? false;
    final canRooms = me?.lodge.hasRooms ?? false;
    final catering = canCater && _catering;
    final roomsOn = canRooms && _roomsRequired;
    final venues = state.pickableVenues(widget.event?.venueId.toString());
    final venue = _venue;
    final submitting = state.submitting;

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit "${widget.event!.title}"' : 'New function enquiry')),
      body: !_catalogueReady
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: ListView(
                controller: _scrollController,
                padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, AppTheme.s24),
                children: [
                  if (_error != null) ...[
                    Container(
                      padding: const EdgeInsets.all(AppTheme.s8),
                      decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
                      child: Row(
                        children: [
                          const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(child: Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 13))),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppTheme.s8),
                  ],

                  // ── Function ───────────────────────────────────────────
                  NeuCard(
                    padding: const EdgeInsets.all(AppTheme.s8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SectionLabel('Function', number: 1),
                        const SizedBox(height: AppTheme.s8),
                        RequiredLabel('Type'),
                        const SizedBox(height: 4),
                        _Dropdown<String>(
                          value: _eventType,
                          items: kEventTypeLabel,
                          onChanged: (v) => setState(() => _eventType = v),
                        ),
                        const SizedBox(height: AppTheme.s8),
                        NeuField(
                          key: _fieldKeys['title'],
                          controller: _title,
                          label: 'Title',
                          hint: 'Sharma–Patil reception',
                          required: true,
                          errorText: _submitAttempted && _fieldError == 'title' ? _error : null,
                          forceCapitalizeWords: true,
                        ),
                        const SizedBox(height: AppTheme.s8),
                        RequiredLabel('Venue'),
                        const SizedBox(height: 4),
                        Container(
                          key: _fieldKeys['venue'],
                          decoration: _submitAttempted && _fieldError == 'venue'
                              ? BoxDecoration(border: Border.all(color: AppTheme.danger, width: 1.4), borderRadius: BorderRadius.circular(AppTheme.rSmall))
                              : null,
                          child: _Dropdown<int?>(
                            value: _venueId,
                            items: {for (final v in venues) v.id: '${v.name}${v.capacityPax != null ? ' (up to ${v.capacityPax})' : ''}'},
                            onChanged: (v) {
                              setState(() {
                                _venueId = v;
                                final picked = venues.firstWhereOrNull((x) => x.id == v);
                                if (picked != null) _venueCharge.text = picked.baseCharge.toString();
                              });
                              _checkAvailability();
                              _refreshQuote();
                            },
                          ),
                        ),
                        if (_submitAttempted && _fieldError == 'venue')
                          Padding(padding: const EdgeInsets.only(top: 4), child: Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12))),
                        const SizedBox(height: AppTheme.s8),
                        const Text('Slot', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                        const SizedBox(height: 4),
                        _Dropdown<String>(
                          value: _slot,
                          items: kSlotLabel,
                          onChanged: _pickSlot,
                        ),
                        const SizedBox(height: AppTheme.s8),
                        Row(
                          children: [
                            Expanded(
                              child: _DateTimeField(label: 'Starts', date: _startDate, time: _startTime, onDate: () => _pickDate(isStart: true), onTime: () => _pickTime(isStart: true)),
                            ),
                            const SizedBox(width: AppTheme.s8),
                            Expanded(
                              key: _fieldKeys['end'],
                              child: _DateTimeField(label: 'Ends', date: _endDate, time: _endTime, onDate: () => _pickDate(isStart: false), onTime: () => _pickTime(isStart: false)),
                            ),
                          ],
                        ),
                        if (_submitAttempted && _fieldError == 'end')
                          Padding(padding: const EdgeInsets.only(top: 4), child: Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12))),
                        if (_checkingAvailability) _AvailBanner(text: 'Checking the venue…', color: AppTheme.muted)
                        else if (_availability != null && _availability!.available)
                          _AvailBanner(text: '${venue?.name ?? 'Venue'} is available for these hours.', color: AppTheme.vacant)
                        else if (_availability != null && !_availability!.available)
                          _AvailBanner(
                            text: '${venue?.name ?? 'This venue'} is already taken: ${_availability!.clashes.map((c) => '"${c.title}" (${c.organiserName})').join('; ')}',
                            color: AppTheme.danger,
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTheme.s8),

                  // ── Organiser ──────────────────────────────────────────
                  NeuCard(
                    padding: const EdgeInsets.all(AppTheme.s8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SectionLabel('Organiser', number: 2),
                        const SizedBox(height: AppTheme.s8),
                        NeuField(key: _fieldKeys['organiserName'], controller: _organiserName, label: 'Name', required: true, errorText: _submitAttempted && _fieldError == 'organiserName' ? _error : null, forceCapitalizeWords: true),
                        const SizedBox(height: AppTheme.s8),
                        NeuField(
                          key: _fieldKeys['organiserPhone'],
                          controller: _organiserPhone,
                          label: 'Mobile',
                          required: true,
                          keyboardType: TextInputType.phone,
                          maxLength: 10,
                          errorText: _submitAttempted && _fieldError == 'organiserPhone' ? _error : null,
                        ),
                        const SizedBox(height: AppTheme.s8),
                        NeuField(controller: _organiserAltPhone, label: 'Alternate number (optional)', keyboardType: TextInputType.phone, maxLength: 10),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTheme.s8),

                  // ── Guests & pricing ───────────────────────────────────
                  NeuCard(
                    padding: const EdgeInsets.all(AppTheme.s8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SectionLabel('Guests & pricing', number: 3),
                        const SizedBox(height: AppTheme.s8),
                        Row(
                          children: [
                            Expanded(
                              child: NeuField(
                                key: _fieldKeys['expectedPax'],
                                controller: _expectedPax,
                                label: 'Expected guests',
                                required: true,
                                keyboardType: TextInputType.number,
                                errorText: _submitAttempted && _fieldError == 'expectedPax' ? _error : null,
                                onChanged: (_) => _scheduleQuote(),
                              ),
                            ),
                            const SizedBox(width: AppTheme.s8),
                            Expanded(
                              child: NeuField(controller: _venueCharge, label: 'Venue hire charge', keyboardType: TextInputType.number, onChanged: (_) => _scheduleQuote()),
                            ),
                          ],
                        ),
                        if (canCater || canRooms) ...[
                          const SizedBox(height: AppTheme.s8),
                          Wrap(
                            spacing: 12,
                            children: [
                              if (canCater)
                                _CheckRow(label: 'Catering required', value: _catering, onChanged: (v) {
                                  setState(() => _catering = v);
                                  _scheduleQuote();
                                }),
                              if (canRooms)
                                _CheckRow(label: 'Rooms required', value: _roomsRequired, onChanged: _toggleRooms),
                            ],
                          ),
                        ],
                        if (catering) ...[
                          const SizedBox(height: AppTheme.s8),
                          Row(
                            children: [
                              Expanded(
                                child: NeuField(
                                  key: _fieldKeys['perPlateRate'],
                                  controller: _perPlateRate,
                                  label: 'Per-plate rate',
                                  required: true,
                                  keyboardType: TextInputType.number,
                                  errorText: _submitAttempted && _fieldError == 'perPlateRate' ? _error : null,
                                  onChanged: (_) => _scheduleQuote(),
                                ),
                              ),
                              const SizedBox(width: AppTheme.s8),
                              Expanded(
                                child: NeuField(controller: _guaranteedPax, label: 'Guaranteed minimum', keyboardType: TextInputType.number, onChanged: (_) => _scheduleQuote()),
                              ),
                            ],
                          ),
                        ],
                        if (roomsOn) ...[
                          const SizedBox(height: AppTheme.s8),
                          Row(
                            children: [
                              Expanded(
                                child: NeuField(
                                  key: _fieldKeys['roomsCount'],
                                  controller: _roomsCount,
                                  label: 'Rooms needed',
                                  required: true,
                                  keyboardType: TextInputType.number,
                                  errorText: _submitAttempted && _fieldError == 'roomsCount' ? _error : null,
                                ),
                              ),
                              const SizedBox(width: AppTheme.s8),
                              Expanded(key: _fieldKeys['roomsFrom'], child: _PlainDateField(label: 'From (night of)', date: _roomsFrom, onTap: () => _pickRoomsDate(isFrom: true))),
                              const SizedBox(width: AppTheme.s8),
                              Expanded(key: _fieldKeys['roomsTo'], child: _PlainDateField(label: 'Until (morning of)', date: _roomsTo, onTap: () => _pickRoomsDate(isFrom: false))),
                            ],
                          ),
                          if (_submitAttempted && (_fieldError == 'roomsFrom' || _fieldError == 'roomsTo'))
                            Padding(padding: const EdgeInsets.only(top: 4), child: Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12))),
                          const SizedBox(height: AppTheme.s8),
                          NeuField(controller: _roomsNotes, label: 'Room notes (optional)', hint: 'Two on the ground floor for grandparents, …'),
                        ],
                        const SizedBox(height: AppTheme.s8),
                        const Text('Add-ons', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                        const SizedBox(height: 6),
                        if (_lines.isEmpty) const Text('No add-ons in the catalogue yet.', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                        for (final l in _lines) _AddonLineTile(line: l, onChanged: () { setState(() {}); _scheduleQuote(); }),
                        const SizedBox(height: AppTheme.s8),
                        Row(
                          children: [
                            Expanded(child: NeuField(controller: _oneOffLabel, label: '', hint: 'One-off item (e.g. mandap flowers)')),
                            const SizedBox(width: 6),
                            SizedBox(width: 80, child: NeuField(controller: _oneOffAmount, label: '', hint: '₹', keyboardType: TextInputType.number)),
                            const SizedBox(width: 6),
                            NeuButton(onPressed: _addOneOff, padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s12), child: const Text('Add')),
                          ],
                        ),
                        const SizedBox(height: AppTheme.s8),
                        Row(
                          children: [
                            Expanded(child: NeuField(controller: _discountAmount, label: 'Concession', keyboardType: TextInputType.number, onChanged: (_) => _scheduleQuote())),
                            const SizedBox(width: AppTheme.s8),
                            Expanded(child: NeuField(controller: _discountReason, label: 'Reason for concession')),
                          ],
                        ),
                        if (_quoting) const Padding(padding: EdgeInsets.only(top: AppTheme.s8), child: Text('Pricing…', style: TextStyle(color: AppTheme.muted, fontSize: 12))),
                        if (_quoteError != null) Padding(padding: const EdgeInsets.only(top: AppTheme.s8), child: Text(_quoteError!, style: const TextStyle(color: AppTheme.danger, fontSize: 12))),
                        if (_quote != null) ...[
                          const SizedBox(height: AppTheme.s8),
                          _QuoteCard(quote: _quote!, advance: _advanceAmount, overCapacity: _quote!.overCapacity),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTheme.s8),

                  if (!_isEdit) ...[
                    NeuCard(
                      key: _fieldKeys['advance'],
                      padding: const EdgeInsets.all(AppTheme.s8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const SectionLabel('Advance payment', number: 4),
                          const SizedBox(height: 4),
                          const Text(
                            'Optional. Money taken now confirms the venue is theirs from this moment, whichever way you save below.',
                            style: TextStyle(color: AppTheme.muted, fontSize: 12),
                          ),
                          const SizedBox(height: AppTheme.s8),
                          for (var i = 0; i < _advanceLines.length; i++)
                            Padding(
                              padding: const EdgeInsets.only(bottom: AppTheme.s8),
                              child: PaymentRow(
                                key: ValueKey(_advanceLines[i]),
                                line: _advanceLines[i],
                                onRemove: _advanceLines.length == 1 ? null : () => setState(() => _advanceLines.removeAt(i)),
                                onChanged: () => setState(() {}),
                              ),
                            ),
                          if (_advanceLines.length < 5)
                            NeuButton(expand: true, onPressed: () => setState(() => _advanceLines.add(PaymentDraft())), child: const Text('+ Add another payment')),
                          if (_submitAttempted && _fieldError == 'advance')
                            Padding(padding: const EdgeInsets.only(top: AppTheme.s8), child: Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12))),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppTheme.s8),
                  ],

                  // ── Function sheet ─────────────────────────────────────
                  NeuCard(
                    padding: const EdgeInsets.all(AppTheme.s8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SectionLabel('Function sheet', number: _isEdit ? 4 : 5),
                        const SizedBox(height: AppTheme.s8),
                        if (catering) ...[
                          NeuField(controller: _menuNotes, label: 'Menu', hint: 'Veg thali, live chaat counter, …'),
                          const SizedBox(height: AppTheme.s8),
                        ],
                        NeuField(controller: _setupNotes, label: 'Setup', hint: 'Round tables for 10, stage at north end, …'),
                        const SizedBox(height: AppTheme.s8),
                        NeuField(controller: _scheduleNotes, label: 'Schedule', hint: 'Baraat 7 pm, dinner 9 pm, …'),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTheme.s16),

                  if (_isEdit)
                    Align(
                      alignment: Alignment.centerRight,
                      child: NeuButton(primary: true, onPressed: submitting ? null : () => _save(), child: Text(submitting ? 'Saving…' : 'Save changes')),
                    )
                  else ...[
                    Row(
                      children: [
                        Expanded(child: NeuField(controller: _holdHours, label: 'Hold hours', keyboardType: TextInputType.number)),
                      ],
                    ),
                    const SizedBox(height: AppTheme.s8),
                    Column(
                      children: [
                        NeuButton(expand: true, onPressed: submitting ? null : () => _save(status: 'ENQUIRY'), child: Text(submitting ? 'Saving…' : 'Save as enquiry')),
                        const SizedBox(height: AppTheme.s8),
                        NeuButton(expand: true, onPressed: submitting ? null : () => _save(status: 'TENTATIVE'), child: Text('Hold the date (${_holdHours.text.trim().isEmpty ? '48' : _holdHours.text.trim()} h)')),
                        const SizedBox(height: AppTheme.s8),
                        NeuButton(expand: true, primary: true, onPressed: submitting ? null : () => _save(status: 'CONFIRMED'), child: Text(submitting ? 'Saving…' : 'Confirm now')),
                      ],
                    ),
                  ],
                ],
              ),
            ),
    );
  }
}

class _AddonLineDraft {
  final int? addonId;
  final String label;
  final num? unitAmount;
  int quantity;
  String? agreedAmount;
  bool selected;
  final bool isExtra;
  final bool needsPricing;
  final String? notedAt;

  _AddonLineDraft({
    this.addonId,
    required this.label,
    this.unitAmount,
    this.quantity = 1,
    this.agreedAmount,
    this.selected = false,
    this.isExtra = false,
    this.needsPricing = false,
    this.notedAt,
  });
}

class _AddonLineTile extends StatelessWidget {
  final _AddonLineDraft line;
  final VoidCallback onChanged;

  const _AddonLineTile({required this.line, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Checkbox(
            value: line.selected,
            onChanged: (v) {
              line.selected = v ?? false;
              onChanged();
            },
          ),
          Expanded(child: Text(line.label, style: const TextStyle(color: AppTheme.text, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis)),
          if (line.selected) ...[
            SizedBox(
              width: 46,
              child: TextField(
                controller: TextEditingController(text: line.quantity.toString()),
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12),
                decoration: const InputDecoration(isDense: true, contentPadding: EdgeInsets.symmetric(vertical: 6)),
                onChanged: (v) {
                  line.quantity = int.tryParse(v) ?? 1;
                  onChanged();
                },
              ),
            ),
            const SizedBox(width: 6),
            SizedBox(
              width: 70,
              child: TextField(
                controller: TextEditingController(text: line.agreedAmount ?? ''),
                keyboardType: TextInputType.number,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12),
                decoration: InputDecoration(isDense: true, contentPadding: const EdgeInsets.symmetric(vertical: 6), hintText: line.unitAmount?.toString() ?? '₹'),
                onChanged: (v) {
                  line.agreedAmount = v;
                  onChanged();
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Dropdown<T> extends StatelessWidget {
  final T value;
  final Map<T, String> items;
  final ValueChanged<T> onChanged;

  const _Dropdown({required this.value, required this.items, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return NeuPressed(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: items.containsKey(value) ? value : null,
          isExpanded: true,
          dropdownColor: AppTheme.bg,
          hint: const Text('Choose', style: TextStyle(color: AppTheme.muted, fontSize: 14)),
          style: const TextStyle(color: AppTheme.heading, fontSize: 14),
          items: [for (final e in items.entries) DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis))],
          onChanged: (v) {
            if (v != null || null is T) onChanged(v as T);
          },
        ),
      ),
    );
  }
}

class _DateTimeField extends StatelessWidget {
  final String label;
  final DateTime date;
  final TimeOfDay time;
  final VoidCallback onDate;
  final VoidCallback onTime;

  const _DateTimeField({required this.label, required this.date, required this.time, required this.onDate, required this.onTime});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
        const SizedBox(height: 4),
        Row(
          children: [
            Expanded(
              child: InkWell(
                onTap: onDate,
                child: NeuPressed(padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s12), child: Text(formatDate(date), style: const TextStyle(color: AppTheme.heading, fontSize: 12))),
              ),
            ),
            const SizedBox(width: 4),
            Expanded(
              child: InkWell(
                onTap: onTime,
                child: NeuPressed(padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s12), child: Text(time.format(context), style: const TextStyle(color: AppTheme.heading, fontSize: 12))),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _PlainDateField extends StatelessWidget {
  final String label;
  final DateTime? date;
  final VoidCallback onTap;

  const _PlainDateField({required this.label, required this.date, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
        const SizedBox(height: 4),
        InkWell(
          onTap: onTap,
          child: NeuPressed(padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s12), child: Text(date == null ? '—' : formatDate(date), style: const TextStyle(color: AppTheme.heading, fontSize: 12))),
        ),
      ],
    );
  }
}

class _CheckRow extends StatelessWidget {
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _CheckRow({required this.label, required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onChanged(!value),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(value ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded, size: 18, color: value ? AppTheme.accent : AppTheme.muted),
          const SizedBox(width: 4),
          Text(label, style: const TextStyle(color: AppTheme.text, fontSize: 13)),
        ],
      ),
    );
  }
}

class _AvailBanner extends StatelessWidget {
  final String text;
  final Color color;

  const _AvailBanner({required this.text, required this.color});

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
  final EventQuoteResult quote;
  final num advance;
  final String? overCapacity;

  const _QuoteCard({required this.quote, required this.advance, this.overCapacity});

  @override
  Widget build(BuildContext context) {
    final p = quote.pricing;
    return Container(
      padding: const EdgeInsets.all(AppTheme.s8),
      decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(AppTheme.rSmall)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (overCapacity != null) ...[
            Text(overCapacity!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
            const SizedBox(height: AppTheme.s8),
          ],
          for (final l in p.lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Expanded(child: Text(l.note != null ? '${l.label} (${l.note})' : l.label, style: const TextStyle(color: AppTheme.text, fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis)),
                  Text(formatPrice(l.amount), style: const TextStyle(color: AppTheme.text, fontSize: 12)),
                ],
              ),
            ),
          if (p.discountAmount > 0)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  const Expanded(child: Text('Concession', style: TextStyle(color: AppTheme.text, fontSize: 12))),
                  Text('− ${formatPrice(p.discountAmount)}', style: const TextStyle(color: AppTheme.text, fontSize: 12)),
                ],
              ),
            ),
          const Divider(height: 12, color: AppTheme.border),
          Row(
            children: [
              const Expanded(child: Text('Total', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13))),
              Text(formatPrice(p.totalAmount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13)),
            ],
          ),
          if (advance > 0) ...[
            Row(
              children: [
                const Expanded(child: Text('Advance now', style: TextStyle(color: AppTheme.text, fontSize: 12))),
                Text('− ${formatPrice(advance)}', style: const TextStyle(color: AppTheme.text, fontSize: 12)),
              ],
            ),
            Row(
              children: [
                const Expanded(child: Text('Balance', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 12))),
                Text(formatPrice((p.totalAmount - advance).clamp(0, double.infinity)), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 12)),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
  T? firstWhereOrNull(bool Function(T) test) {
    for (final e in this) {
      if (test(e)) return e;
    }
    return null;
  }
}
