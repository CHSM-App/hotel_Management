import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/dio_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

// Which guest messages go out by themselves and which the desk sends by hand.
// Same keys and wording as the web's WhatsAppSettingsPanel (WA_MESSAGES).
const _messages = [
  ('waAutoBooking', 'Bookings', 'Booking confirmation', 'When a booking is saved.'),
  ('waAutoWalkin', 'Bookings', 'Walk-in welcome', 'When a walk-in guest is checked in.'),
  ('waAutoCancel', 'Bookings', 'Booking cancelled', 'When a booking is cancelled.'),
  ('waAutoBill', 'Billing', 'Bill link', 'As soon as a bill is issued.'),
  (
    'waAutoReceipt',
    'Billing',
    'Advance receipt',
    'When an advance is taken. The booking confirmation already has a receipt link.',
  ),
];

/// Owner-only: choose Auto or Manual for each WhatsApp message. Manual adds a
/// Send button on the booking or bill; it keeps working either way.
class WhatsAppSettingsScreen extends ConsumerStatefulWidget {
  const WhatsAppSettingsScreen({super.key});

  @override
  ConsumerState<WhatsAppSettingsScreen> createState() => _State();
}

class _State extends ConsumerState<WhatsAppSettingsScreen> {
  Map<String, dynamic>? _settings;
  String? _error;
  String? _saving;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final s = await ref.read(apiServiceProvider).mySettings();
      if (mounted) setState(() => _settings = s);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _pick(String key, bool auto) async {
    setState(() {
      _saving = key;
      _error = null;
    });
    try {
      final s = await ref.read(apiServiceProvider).updateMySettings({key: auto});
      if (mounted) setState(() => _settings = s);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _saving = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _settings;
    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(title: const Text('WhatsApp messages')),
      body: SafeArea(
        child: s == null
            ? Center(
                child: _error == null
                    ? const CircularProgressIndicator()
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, style: const TextStyle(color: AppTheme.danger)),
                          TextButton(onPressed: _load, child: const Text('Retry')),
                        ],
                      ),
              )
            : Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: AppTheme.formMaxWidth(context)),
                  child: ListView(
                    padding: const EdgeInsets.all(AppTheme.s16),
                    children: [
                      Text(
                        'Auto sends the message by itself. Manual adds a Send button on the booking or bill.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: AppTheme.s8),
                        Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12.5)),
                      ],
                      for (final group in const ['Bookings', 'Billing']) ...[
                        const SizedBox(height: AppTheme.s16),
                        Text(
                          group.toUpperCase(),
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.6),
                        ),
                        const SizedBox(height: AppTheme.s8),
                        NeuCard(
                          padding: EdgeInsets.zero,
                          child: Column(
                            children: [
                              for (final m in _messages.where((m) => m.$2 == group))
                                _Row(
                                  title: m.$3,
                                  note: m.$4,
                                  auto: s[m.$1] == true,
                                  busy: _saving == m.$1,
                                  onPick: (auto) => _pick(m.$1, auto),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String title;
  final String note;
  final bool auto;
  final bool busy;
  final ValueChanged<bool> onPick;

  const _Row({
    required this.title,
    required this.note,
    required this.auto,
    required this.busy,
    required this.onPick,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontSize: 14.5)),
                const SizedBox(height: 2),
                Text(note, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          SegmentedButton<bool>(
            showSelectedIcon: false,
            style: const ButtonStyle(visualDensity: VisualDensity.compact),
            segments: const [
              ButtonSegment(value: true, label: Text('Auto')),
              ButtonSegment(value: false, label: Text('Manual')),
            ],
            selected: {auto},
            onSelectionChanged: busy ? null : (v) => onPick(v.first),
          ),
        ],
      ),
    );
  }
}
