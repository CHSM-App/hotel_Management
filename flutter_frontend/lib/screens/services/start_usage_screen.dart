import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Start a service — mirrors the 'useForm' modal in ServicesPanel.jsx: pick
/// a guest staying in-house, or type a walk-in's name.
Future<void> showStartUsageScreen(BuildContext context) {
  return Navigator.of(context).push(MaterialPageRoute(builder: (_) => const StartUsageScreen()));
}

class StartUsageScreen extends ConsumerStatefulWidget {
  const StartUsageScreen({super.key});

  @override
  ConsumerState<StartUsageScreen> createState() => _StartUsageScreenState();
}

class _StartUsageScreenState extends ConsumerState<StartUsageScreen> {
  int? _serviceId;
  final _quantity = TextEditingController(text: '1');
  int? _bookingId;
  final _guestName = TextEditingController();
  final _guestPhone = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _quantity.dispose();
    _guestName.dispose();
    _guestPhone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_serviceId == null) {
      setState(() => _error = 'Choose a service.');
      return;
    }
    final qty = num.tryParse(_quantity.text.trim());
    if (qty == null || qty <= 0) {
      setState(() => _error = 'Quantity must be more than 0.');
      return;
    }
    final ok = await ref.read(lodgeServicesViewModelProvider.notifier).startUsage({
      'serviceId': _serviceId,
      'quantity': qty,
      'bookingId': _bookingId,
      'guestName': _bookingId == null ? _guestName.text.trim() : '',
      'guestPhone': _bookingId == null ? _guestPhone.text.trim() : '',
    });
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(lodgeServicesViewModelProvider).error ?? 'Could not start this service.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(lodgeServicesViewModelProvider);
    final active = state.activeServices;
    final picked = active.where((s) => s.id == _serviceId).firstOrNull;
    final amount = picked == null ? null : picked.price * (num.tryParse(_quantity.text.trim()) ?? 0);

    return Scaffold(
      appBar: AppBar(title: const Text('Start a service')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_error != null) ...[
                    _ErrorBanner(_error!),
                    const SizedBox(height: AppTheme.s16),
                  ],
                  const Text("Pick a guest staying in-house, or type a walk-in's name.", style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
                  const SizedBox(height: AppTheme.s12),
                  if (active.isEmpty) ...[
                    const _ErrorBanner('Add a service under "Services & prices" first.'),
                    const SizedBox(height: AppTheme.s12),
                  ],
                  const RequiredLabel('Service'),
                  const SizedBox(height: AppTheme.s8),
                  OptionDropdown(
                    values: active.map((s) => '${s.id}').toList(),
                    labels: {for (final s in active) '${s.id}': '${s.name} — ${formatPrice(s.price)} per ${s.unitLabel}'},
                    selected: _serviceId?.toString(),
                    onSelect: (v) => setState(() => _serviceId = int.parse(v)),
                    hint: 'Choose…',
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _quantity,
                    label: picked != null ? 'Quantity (${picked.unitLabel})' : 'Quantity',
                    keyboardType: TextInputType.number,
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  const Text('Staying guest', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: AppTheme.s8),
                  OptionDropdown(
                    values: state.inHouseGuests.map((g) => '${g.bookingId}').toList(),
                    labels: {for (final g in state.inHouseGuests) '${g.bookingId}': 'Room ${g.roomNumber} · ${g.guestName}'},
                    selected: _bookingId?.toString(),
                    onSelect: (v) => setState(() => _bookingId = int.parse(v)),
                    hint: 'Walk-in / not staying',
                  ),
                  if (_bookingId != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: TextButton(onPressed: () => setState(() => _bookingId = null), child: const Text('Walk-in / not staying instead')),
                    ),
                  if (_bookingId == null) ...[
                    const SizedBox(height: AppTheme.s12),
                    Row(
                      children: [
                        Expanded(child: NeuField(controller: _guestName, label: 'Name', forceCapitalizeWords: true)),
                        const SizedBox(width: AppTheme.s12),
                        Expanded(child: NeuField(controller: _guestPhone, label: 'Phone', keyboardType: TextInputType.phone)),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s16),
            NeuCard(
              child: Row(
                children: [
                  const Text('Amount', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 13)),
                  const Spacer(),
                  Text(amount == null ? '—' : formatPrice(amount), style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w800, fontSize: 16)),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: state.submitting ? null : _submit,
              child: state.submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Start'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  final String message;
  const _ErrorBanner(this.message);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
          const SizedBox(width: AppTheme.s8),
          Expanded(child: Text(message, style: const TextStyle(color: AppTheme.danger, fontSize: 13))),
        ],
      ),
    );
  }
}
