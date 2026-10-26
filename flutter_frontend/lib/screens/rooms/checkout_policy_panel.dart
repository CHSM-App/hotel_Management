import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/checkout_policy.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

const _modeLabel = {
  'HOUR_24': '24-hour stays',
  'NIGHT_BASED': 'Night-based stays',
  'CYCLE': 'Fixed check-in / checkout cycle',
  'HYBRID': 'Hybrid: early arrival 24 hours',
};

const _modeNote = {
  'HOUR_24':
      'This property sells a 24-hour cycle, so a stay is due to end 24 hours '
      'per night after the guest actually checked in — arrive at 8pm for two '
      'nights and you are due out at 8pm two days later. Every guest gets '
      'their own deadline, so there is no property-wide checkout time to set.',
  'NIGHT_BASED':
      'This property is night-based, so every stay is due to end at the '
      'checkout time below on the departure date, whatever time the guest '
      'arrived.',
  'CYCLE':
      'This property sells a fixed cycle: rooms are ready from the check-in '
      'time and every stay is due out by the checkout time. Each time a stay '
      'runs past the checkout time it has started another night — a guest '
      'arriving at 2pm and leaving at noon the next day has stayed two '
      'nights, not one night plus a late fee.',
  'HYBRID':
      'A guest who arrives before the check-in time gets a full 24 hours from '
      'the moment they arrive — in at 10am, out by 10am the next day. A guest '
      'who arrives at or after the check-in time is due out at the fixed '
      'checkout time the next day. Late fees apply only if you set a charge '
      'below; leave the percentages at 0 for none.',
};

/// "1h 30m" reads better than "90" — owners think in hours, the policy
/// stores minutes.
String _hoursAndMinutes(int minutes) {
  if (minutes == 0) return 'immediately';
  final h = minutes ~/ 60;
  final m = minutes % 60;
  if (h == 0) return '$m min';
  return m == 0 ? '${h}h' : '${h}h ${m}m';
}

class _PreviewStep {
  final String tone;
  final String when;
  final String charge;
  const _PreviewStep(this.tone, this.when, this.charge);
}

/// The policy read back as the bands reception will actually be quoted. A
/// CYCLE property only has two: within grace, or a whole extra night.
List<_PreviewStep> _previewSteps(CheckoutPolicy policy) {
  final grace = policy.lateGraceMinutes;
  final fullAfter = policy.lateFullDayAfterMinutes;

  if (policy.checkinMode == 'CYCLE') {
    return [
      _PreviewStep(
        'free',
        grace == 0 ? 'Out by the checkout time' : 'Up to ${_hoursAndMinutes(grace)} past checkout',
        'No charge',
      ),
      _PreviewStep(
        'full',
        'Later than ${grace == 0 ? 'the checkout time' : '${_hoursAndMinutes(grace)} past checkout'}',
        'One more night, at the last night’s rate',
      ),
    ];
  }

  return [
    _PreviewStep(
      'free',
      grace == 0 ? 'From the checkout deadline' : 'First ${_hoursAndMinutes(grace)} past checkout',
      grace == 0 ? 'No free grace period' : 'No charge',
    ),
    _PreviewStep(
      'half',
      grace == 0
          ? 'Up to ${_hoursAndMinutes(fullAfter)} past checkout'
          : 'From ${_hoursAndMinutes(grace)} to ${_hoursAndMinutes(fullAfter)} past checkout',
      '${policy.lateHalfDayPercent}% of a night',
    ),
    _PreviewStep(
      'full',
      'More than ${_hoursAndMinutes(fullAfter)} past checkout',
      '${policy.lateFullDayPercent}% of a night',
    ),
  ];
}

const _toneColor = {
  'free': AppTheme.vacant,
  'half': AppTheme.draft,
  'full': AppTheme.danger,
};

/// Checkout policy — the same settings page the web dashboard's "Rooms &
/// rates" shows under this name: when a stay is due to end, and what
/// reception should charge a guest who stays past it.
class CheckoutPolicyPanel extends ConsumerStatefulWidget {
  const CheckoutPolicyPanel({super.key});

  @override
  ConsumerState<CheckoutPolicyPanel> createState() => _CheckoutPolicyPanelState();
}

class _CheckoutPolicyPanelState extends ConsumerState<CheckoutPolicyPanel> {
  bool _loaded = false;

  late String _checkinMode;
  late TimeOfDay _checkInTime;
  late TimeOfDay _checkOutTime;
  TimeOfDay? _earlyArrivalFrom;
  final _grace = TextEditingController();
  final _halfDayPercent = TextEditingController();
  final _fullDayAfter = TextEditingController();
  final _fullDayPercent = TextEditingController();

  String? _error;
  bool _saved = false;

  @override
  void dispose() {
    _grace.dispose();
    _halfDayPercent.dispose();
    _fullDayAfter.dispose();
    _fullDayPercent.dispose();
    super.dispose();
  }

  void _load(CheckoutPolicy p) {
    _checkinMode = p.checkinMode;
    _checkInTime = _parseTime(p.checkInTime);
    _checkOutTime = _parseTime(p.checkOutTime);
    _earlyArrivalFrom = p.earlyArrivalFrom == null || p.earlyArrivalFrom!.isEmpty
        ? null
        : _parseTime(p.earlyArrivalFrom!);
    _grace.text = '${p.lateGraceMinutes}';
    _halfDayPercent.text = '${p.lateHalfDayPercent}';
    _fullDayAfter.text = '${p.lateFullDayAfterMinutes}';
    _fullDayPercent.text = '${p.lateFullDayPercent}';
    _loaded = true;
  }

  static TimeOfDay _parseTime(String hhmm) {
    final parts = hhmm.split(':');
    final h = int.tryParse(parts.isNotEmpty ? parts[0] : '') ?? 11;
    final m = int.tryParse(parts.length > 1 ? parts[1] : '') ?? 0;
    return TimeOfDay(hour: h, minute: m);
  }

  static String _fmtTime(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  CheckoutPolicy _preview() => CheckoutPolicy(
    checkinMode: _checkinMode,
    checkInTime: _fmtTime(_checkInTime),
    checkOutTime: _fmtTime(_checkOutTime),
    earlyArrivalFrom:
        _earlyArrivalFrom == null ? null : _fmtTime(_earlyArrivalFrom!),
    lateGraceMinutes: int.tryParse(_grace.text.trim()) ?? 0,
    lateHalfDayPercent: num.tryParse(_halfDayPercent.text.trim()) ?? 0,
    lateFullDayAfterMinutes: int.tryParse(_fullDayAfter.text.trim()) ?? 0,
    lateFullDayPercent: num.tryParse(_fullDayPercent.text.trim()) ?? 0,
  );

  Future<void> _pickTime({required bool checkIn, bool early = false}) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: early
          ? (_earlyArrivalFrom ?? const TimeOfDay(hour: 6, minute: 0))
          : (checkIn ? _checkInTime : _checkOutTime),
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(
            primary: AppTheme.accent,
            onPrimary: Colors.white,
            surface: AppTheme.bg,
            onSurface: AppTheme.heading,
          ),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      if (early) {
        _earlyArrivalFrom = picked;
      } else if (checkIn) {
        _checkInTime = picked;
      } else {
        _checkOutTime = picked;
      }
      _saved = false;
    });
  }

  Future<void> _submit() async {
    final grace = int.tryParse(_grace.text.trim());
    if (grace == null || grace < 0) {
      setState(() => _error = 'Enter a free grace period of 0 or more minutes.');
      return;
    }
    final isCycle = _checkinMode == 'CYCLE';
    final isHybrid = _checkinMode == 'HYBRID';
    num? halfPercent = num.tryParse(_halfDayPercent.text.trim());
    int? fullAfter = int.tryParse(_fullDayAfter.text.trim());
    num? fullPercent = num.tryParse(_fullDayPercent.text.trim());
    if (!isCycle) {
      if (halfPercent == null || halfPercent < 0) {
        setState(() => _error = 'Enter a part-day charge of 0 or more percent.');
        return;
      }
      if (fullAfter == null || fullAfter < 0) {
        setState(() => _error = 'Enter when the full-night charge kicks in, in minutes.');
        return;
      }
      if (fullPercent == null || fullPercent < 0) {
        setState(() => _error = 'Enter a full-night charge of 0 or more percent.');
        return;
      }
    }
    setState(() => _error = null);
    final ok = await ref.read(roomsViewModelProvider.notifier).saveCheckoutPolicy(
          checkOutTime: _fmtTime(_checkOutTime),
          checkInTime: isCycle || isHybrid ? _fmtTime(_checkInTime) : null,
          earlyArrivalFrom:
              isHybrid && _earlyArrivalFrom != null ? _fmtTime(_earlyArrivalFrom!) : null,
          sendEarlyArrivalFrom: isHybrid,
          lateGraceMinutes: grace,
          lateHalfDayPercent: halfPercent ?? 0,
          lateFullDayAfterMinutes: fullAfter ?? 0,
          lateFullDayPercent: fullPercent ?? 0,
        );
    if (!mounted) return;
    if (ok) {
      setState(() => _saved = true);
    } else {
      setState(() => _error = ref.read(roomsViewModelProvider).error ?? 'Could not save the checkout policy.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(roomsViewModelProvider);
    final policy = state.checkoutPolicy;
    if (policy == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (!_loaded) _load(policy);

    final submitting = state.submitting;
    final isCycle = _checkinMode == 'CYCLE';
    final isHybrid = _checkinMode == 'HYBRID';
    final preview = _previewSteps(_preview());

    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, AppTheme.s24),
          children: [
            NeuCard(
              radius: AppTheme.rLarge,
              padding: const EdgeInsets.all(AppTheme.s12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Checkout policy',
                    style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                  const SizedBox(height: 2),
                  const Text(
                    'When a stay ends, and the late-checkout charge.',
                    style: TextStyle(color: AppTheme.muted, fontSize: 11, height: 1.3),
                  ),
                  const SizedBox(height: AppTheme.s8),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppTheme.sidebarBrandWash,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          _modeLabel[_checkinMode] ?? _checkinMode,
                          style: const TextStyle(
                            color: AppTheme.sidebarBrandInk,
                            fontWeight: FontWeight.w700,
                            fontSize: 10.5,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s12),

            // ── When a stay ends ──────────────────────────────────────────
            _PolicySection(
              icon: Icons.schedule_rounded,
              title: 'When a stay ends',
              note: _modeNote[_checkinMode] ?? '',
              child: _checkinMode == 'HOUR_24'
                  ? Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppTheme.sidebarBrandWash,
                        borderRadius: BorderRadius.circular(AppTheme.rSmall),
                        border: Border.all(color: AppTheme.sidebarBrandWashEdge),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'DUE OUT',
                            style: TextStyle(
                              color: AppTheme.sidebarBrandInk,
                              fontWeight: FontWeight.w700,
                              fontSize: 10,
                              letterSpacing: 0.4,
                            ),
                          ),
                          const SizedBox(height: 2),
                          const Text(
                            'Arrival time + 24 hours per night booked',
                            style: TextStyle(
                              color: AppTheme.heading,
                              fontWeight: FontWeight.w700,
                              fontSize: 13.5,
                            ),
                          ),
                        ],
                      ),
                    )
                  : isCycle || isHybrid
                      ? Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: _TimeField(
                                    label: 'Check-in from',
                                    time: _checkInTime,
                                    hint: isHybrid
                                        ? 'Arrive before this and you get 24 hours from arrival; at or after it, checkout is the fixed time.'
                                        : 'When rooms are ready.',
                                    onTap: () => _pickTime(checkIn: true),
                                  ),
                                ),
                                const SizedBox(width: AppTheme.s8),
                                Expanded(
                                  child: _TimeField(
                                    label: 'Checkout by',
                                    time: _checkOutTime,
                                    hint: isHybrid
                                        ? 'The fixed checkout for guests who arrive at or after the check-in time.'
                                        : 'Past this starts another night.',
                                    onTap: () => _pickTime(checkIn: false),
                                  ),
                                ),
                              ],
                            ),
                            if (isHybrid) ...[
                              const SizedBox(height: AppTheme.s8),
                              _TimeField(
                                label: 'Early arrival counts from',
                                time: _earlyArrivalFrom,
                                placeholder: 'Any time before check-in',
                                hint:
                                    'Optional. Blank means any time before check-in; set 06:00 and a 3am arrival keeps the fixed checkout instead.',
                                onTap: () => _pickTime(checkIn: false, early: true),
                                onClear: _earlyArrivalFrom == null
                                    ? null
                                    : () => setState(() {
                                          _earlyArrivalFrom = null;
                                          _saved = false;
                                        }),
                              ),
                            ],
                          ],
                        )
                      : _TimeField(
                          label: 'Checkout time',
                          time: _checkOutTime,
                          hint: 'Every stay is due to end at this time on the departure date.',
                          onTap: () => _pickTime(checkIn: false),
                        ),
            ),
            const SizedBox(height: AppTheme.s12),

            // ── Charging for a late checkout ─────────────────────────────
            _PolicySection(
              icon: Icons.payments_rounded,
              title: 'Charging for a late checkout',
              note: isCycle
                  ? 'Reception is shown the extra nights as a suggestion when they check '
                      'out a guest who has run past the checkout time — they can change '
                      'the amount or waive it. Only the grace period applies here; the '
                      'part-day bands are not used on a cycle property.'
                  : 'Reception is shown this as a suggestion when they check out a guest '
                      'who has run past the deadline — they can change it or waive it. '
                      'Percentages are of the room’s rate on its last night, so a '
                      'suite and a single scale on their own tariff.',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: NeuField(
                          controller: _grace,
                          label: 'Free grace period',
                          hint: 'min',
                          keyboardType: TextInputType.number,
                          dense: true,
                          onChanged: (_) => setState(() => _saved = false),
                        ),
                      ),
                      if (!isCycle) ...[
                        const SizedBox(width: AppTheme.s8),
                        Expanded(
                          child: NeuField(
                            controller: _halfDayPercent,
                            label: 'Then charge',
                            hint: '% night',
                            keyboardType: TextInputType.number,
                            dense: true,
                            onChanged: (_) => setState(() => _saved = false),
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (!isCycle) ...[
                    const SizedBox(height: AppTheme.s8),
                    Row(
                      children: [
                        Expanded(
                          child: NeuField(
                            controller: _fullDayAfter,
                            label: 'Full-night charge kicks in after',
                            hint: 'min',
                            keyboardType: TextInputType.number,
                            dense: true,
                            onChanged: (_) => setState(() => _saved = false),
                          ),
                        ),
                        const SizedBox(width: AppTheme.s8),
                        Expanded(
                          child: NeuField(
                            controller: _fullDayPercent,
                            label: 'Full-night charge',
                            hint: '% night',
                            keyboardType: TextInputType.number,
                            dense: true,
                            onChanged: (_) => setState(() => _saved = false),
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: AppTheme.s12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(AppTheme.s8 + 2),
                    decoration: BoxDecoration(
                      color: AppTheme.bg,
                      borderRadius: BorderRadius.circular(AppTheme.rSmall),
                      border: Border.all(color: AppTheme.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'WHAT RECEPTION WILL BE QUOTED',
                          style: TextStyle(
                            color: AppTheme.muted,
                            fontWeight: FontWeight.w700,
                            fontSize: 10,
                            letterSpacing: 0.4,
                          ),
                        ),
                        const SizedBox(height: 6),
                        for (final step in preview)
                          Container(
                            margin: const EdgeInsets.only(bottom: 6),
                            padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
                            decoration: BoxDecoration(
                              color: _toneColor[step.tone]!.withValues(alpha: 0.08),
                              borderRadius: BorderRadius.circular(10),
                              border: Border(left: BorderSide(color: _toneColor[step.tone]!, width: 3)),
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  flex: 5,
                                  child: Text(
                                    step.when,
                                    style: const TextStyle(color: AppTheme.muted, fontSize: 11, height: 1.25),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  flex: 4,
                                  child: Text(
                                    step.charge,
                                    textAlign: TextAlign.right,
                                    style: const TextStyle(
                                      color: AppTheme.heading,
                                      fontWeight: FontWeight.w700,
                                      fontSize: 12,
                                      height: 1.25,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            if (_error != null) ...[
              const SizedBox(height: AppTheme.s12),
              Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
            ],

            const SizedBox(height: AppTheme.s12),
            Row(
              children: [
                if (_saved) ...[
                  const Icon(Icons.check_circle_rounded, color: AppTheme.vacant, size: 16),
                  const SizedBox(width: 4),
                  const Text(
                    'Saved',
                    style: TextStyle(color: AppTheme.vacant, fontWeight: FontWeight.w600, fontSize: 12.5),
                  ),
                  const Spacer(),
                ] else
                  const Spacer(),
                SizedBox(
                  width: 160,
                  child: NeuButton(
                    primary: true,
                    onPressed: submitting ? null : _submit,
                    padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                    child: Text(submitting ? 'Saving…' : 'Save policy'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A settings card whose long explanation sits behind an (i) button, so the
/// fields stay in view and the page stays short.
class _PolicySection extends StatefulWidget {
  final IconData icon;
  final String title;
  final String note;
  final Widget child;

  const _PolicySection({
    required this.icon,
    required this.title,
    required this.note,
    required this.child,
  });

  @override
  State<_PolicySection> createState() => _PolicySectionState();
}

class _PolicySectionState extends State<_PolicySection> {
  bool _showNote = false;

  @override
  Widget build(BuildContext context) {
    final icon = widget.icon;
    final title = widget.title;
    final note = widget.note;
    final child = widget.child;
    return NeuCard(
      radius: AppTheme.rLarge,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppTheme.accent, Color(0xFF10499A)],
                  ),
                  borderRadius: BorderRadius.circular(AppTheme.rSmall),
                  boxShadow: const [
                    BoxShadow(color: Color(0x2A1457AD), offset: Offset(0, 2), blurRadius: 5),
                  ],
                ),
                child: Icon(icon, size: 14, color: Colors.white),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14),
                ),
              ),
              if (note.isNotEmpty)
                InkResponse(
                  onTap: () => setState(() => _showNote = !_showNote),
                  radius: 18,
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: Icon(
                      _showNote ? Icons.info_rounded : Icons.info_outline_rounded,
                      size: 18,
                      color: _showNote ? AppTheme.accent : AppTheme.muted,
                    ),
                  ),
                ),
            ],
          ),
          if (_showNote) ...[
            const SizedBox(height: AppTheme.s8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppTheme.s8 + 2),
              decoration: BoxDecoration(
                color: AppTheme.accent.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(AppTheme.rSmall),
              ),
              child: Text(note, style: const TextStyle(color: AppTheme.muted, fontSize: 11, height: 1.4)),
            ),
          ],
          const SizedBox(height: AppTheme.s12),
          child,
        ],
      ),
    );
  }
}

class _TimeField extends StatelessWidget {
  final String label;
  final TimeOfDay? time;
  final String hint;
  final VoidCallback onTap;
  final VoidCallback? onClear;
  final String placeholder;

  const _TimeField({
    required this.label,
    required this.time,
    required this.hint,
    required this.onTap,
    this.onClear,
    this.placeholder = '',
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTheme.fieldLabel(context)),
        const SizedBox(height: AppTheme.s8),
        GestureDetector(
          onTap: onTap,
          child: NeuPressed(
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8 + 2),
            child: Row(
              children: [
                const Icon(Icons.access_time_rounded, size: 15, color: AppTheme.accent),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    time?.format(context) ?? placeholder,
                    style: TextStyle(
                      color: time == null ? AppTheme.muted : AppTheme.heading,
                      fontWeight: FontWeight.w600,
                      fontSize: 13.5,
                    ),
                  ),
                ),
                if (onClear != null)
                  GestureDetector(
                    onTap: onClear,
                    child: const Icon(Icons.close_rounded, size: 16, color: AppTheme.muted),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppTheme.s4),
        Text(hint, style: const TextStyle(color: AppTheme.muted, fontSize: 10.5, height: 1.3)),
      ],
    );
  }
}
