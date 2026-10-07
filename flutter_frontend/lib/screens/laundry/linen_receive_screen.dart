import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'laundry_parts.dart';

/// Receive linen back from the laundry — mirrors the 'receive' modal in
/// LaundryPanel.jsx's LinenTab. Opens filled in with what is in the wash;
/// a shortfall is recorded as lost or damaged.
Future<void> showLinenReceiveScreen(BuildContext context) {
  return Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LinenReceiveScreen()));
}

class _Line {
  int received = 0;
  int lost = 0;
  int damaged = 0;
}

class LinenReceiveScreen extends ConsumerStatefulWidget {
  const LinenReceiveScreen({super.key});

  @override
  ConsumerState<LinenReceiveScreen> createState() => _LinenReceiveScreenState();
}

class _LinenReceiveScreenState extends ConsumerState<LinenReceiveScreen> {
  final Map<int, _Line> _lines = {};
  String _washer = 'OWN';
  final _washedBy = TextEditingController();
  final _price = TextEditingController();
  final _note = TextEditingController();
  String? _error;
  String? _priceError;
  String? _nameError;

  @override
  void initState() {
    super.initState();
    final state = ref.read(laundryViewModelProvider);
    for (final i in state.atLaundry) {
      _lines[i.id] = _Line()..received = i.inLaundry;
    }
    final last = state.lastWasher;
    _washer = last.washer;
    _washedBy.text = last.washedBy;
  }

  @override
  void dispose() {
    _washedBy.dispose();
    _price.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final state = ref.read(laundryViewModelProvider);
    final lines = state.atLaundry
        .map((i) {
          final l = _lines[i.id] ?? _Line();
          return {'linenItemId': i.id, 'received': l.received, 'lost': l.lost, 'damaged': l.damaged};
        })
        .where((l) => (l['received'] as int) + (l['lost'] as int) + (l['damaged'] as int) > 0)
        .toList();
    if (lines.isEmpty) {
      setState(() => _error = 'Tap the counts that came back.');
      return;
    }
    final v = WasherValidation.of(washer: _washer, name: _washedBy.text, price: _price.text);
    if (v.hasError) {
      setState(() {
        _nameError = v.name;
        _priceError = v.price;
        _error = v.name ?? v.price;
      });
      return;
    }
    setState(() {
      _error = null;
      _nameError = null;
      _priceError = null;
    });
    final ok = await ref.read(laundryViewModelProvider.notifier).receiveFromLaundry({
      'lines': lines,
      'note': _note.text.trim(),
      'washedBy': _washer == 'OWN' ? kOwnLaundry : _washedBy.text.trim(),
      'charge': _washer == 'VENDOR' && _price.text.trim().isNotEmpty ? num.tryParse(_price.text.trim()) : null,
    });
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(laundryViewModelProvider).error ?? 'Could not save.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(laundryViewModelProvider);
    final items = state.atLaundry;

    return Scaffold(
      appBar: AppBar(title: const Text('Receive washed')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_error != null) ...[
                    ErrorBanner(_error!),
                    const SizedBox(height: AppTheme.s16),
                  ],
                  const Text('Already filled in with what is in the wash. Lower a count if something has not come back.', style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
                  const SizedBox(height: AppTheme.s12),
                  if (items.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Text('Nothing is in the wash right now.', style: TextStyle(color: AppTheme.muted, fontSize: 13)),
                    ),
                  for (final i in items) _ReceiveRow(item: i, line: _lines[i.id] ??= _Line(), onChanged: () => setState(() {})),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s16),
            NeuCard(
              child: WasherFields(
                washer: _washer,
                onWasherChange: (w) => setState(() => _washer = w),
                nameController: _washedBy,
                priceController: _price,
                priceLabel: 'Price for this batch, ₹',
                nameError: _nameError,
                priceError: _priceError,
              ),
            ),
            const SizedBox(height: AppTheme.s12),
            NeuCard(child: NeuField(controller: _note, label: 'Note (optional)', hint: 'e.g. bag number')),
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: state.submitting || items.isEmpty ? null : _submit,
              child: state.submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Receive'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReceiveRow extends StatelessWidget {
  final LinenItem item;
  final _Line line;
  final VoidCallback onChanged;

  const _ReceiveRow({required this.item, required this.line, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final missing = item.inLaundry - line.received;
    final accounted = line.lost + line.damaged;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.name, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13.5)),
                    Text('${item.inLaundry} in wash', style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                  ],
                ),
              ),
              CountStepper(
                value: line.received,
                max: item.inLaundry,
                onChange: (n) {
                  line.received = n;
                  onChanged();
                },
              ),
            ],
          ),
          if (missing > 0 || accounted > 0) ...[
            const SizedBox(height: 6),
            Text('${(missing - accounted).clamp(0, item.inLaundry)} not back yet. Mark any that are gone:', style: const TextStyle(color: AppTheme.danger, fontSize: 11.5)),
            const SizedBox(height: 6),
            Row(
              children: [
                const Text('Lost', style: TextStyle(color: AppTheme.text, fontSize: 12.5)),
                const SizedBox(width: AppTheme.s8),
                CountStepper(
                  value: line.lost,
                  max: item.inLaundry,
                  onChange: (n) {
                    line.lost = n;
                    onChanged();
                  },
                ),
                const SizedBox(width: AppTheme.s16),
                const Text('Damaged', style: TextStyle(color: AppTheme.text, fontSize: 12.5)),
                const SizedBox(width: AppTheme.s8),
                CountStepper(
                  value: line.damaged,
                  max: item.inLaundry,
                  onChange: (n) {
                    line.damaged = n;
                    onChanged();
                  },
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
