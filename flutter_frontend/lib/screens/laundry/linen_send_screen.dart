import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'laundry_parts.dart';

/// Send dirty linen for washing — mirrors the 'send' modal in
/// LaundryPanel.jsx's LinenTab. Opens already filled in with what is dirty;
/// a count can be raised to send clean linen too.
Future<void> showLinenSendScreen(BuildContext context) {
  return Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LinenSendScreen()));
}

class LinenSendScreen extends ConsumerStatefulWidget {
  const LinenSendScreen({super.key});

  @override
  ConsumerState<LinenSendScreen> createState() => _LinenSendScreenState();
}

class _LinenSendScreenState extends ConsumerState<LinenSendScreen> {
  final Map<int, int> _quantities = {};
  bool _showAll = false;
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
    for (final i in state.activeItems) {
      if (i.dirty > 0) _quantities[i.id] = i.dirty;
    }
    _showAll = state.totalDirty == 0;
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
    final lines = state.activeItems
        .map((i) => {'linenItemId': i.id, 'quantity': _quantities[i.id] ?? 0})
        .where((l) => (l['quantity'] as int) > 0)
        .toList();
    if (lines.isEmpty) {
      setState(() => _error = 'Tap the counts you are sending.');
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
    final ok = await ref.read(laundryViewModelProvider.notifier).sendToLaundry({
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
    final items = state.activeItems;
    final shown = items.where((i) => _showAll || i.dirty > 0).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Send for washing')),
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
                  const Text('Already filled in with what is dirty. Change a count if you send less.', style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
                  const SizedBox(height: AppTheme.s12),
                  for (final i in shown)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(i.name, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13.5)),
                                Text('${i.dirty} dirty', style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                              ],
                            ),
                          ),
                          CountStepper(
                            value: _quantities[i.id] ?? 0,
                            max: i.dirty + i.clean,
                            onChange: (n) => setState(() => _quantities[i.id] = n),
                          ),
                        ],
                      ),
                    ),
                  if (!_showAll && items.any((i) => i.dirty == 0))
                    TextButton(
                      onPressed: () => setState(() => _showAll = true),
                      child: Text('Show all ${items.length} items, to send clean linen too'),
                    ),
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
              onPressed: state.submitting ? null : _submit,
              child: state.submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Send'),
            ),
          ],
        ),
      ),
    );
  }
}
