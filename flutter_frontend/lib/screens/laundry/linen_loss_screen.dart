import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';
import 'laundry_parts.dart';

/// Record linen lost or damaged from a room or the store — mirrors the
/// 'loss' modal in LaundryPanel.jsx's LinenTab.
Future<void> showLinenLossScreen(BuildContext context, {LinenItem? item}) {
  return Navigator.of(context).push(MaterialPageRoute(builder: (_) => LinenLossScreen(item: item)));
}

class LinenLossScreen extends ConsumerStatefulWidget {
  final LinenItem? item;
  const LinenLossScreen({super.key, this.item});

  @override
  ConsumerState<LinenLossScreen> createState() => _LinenLossScreenState();
}

class _LinenLossScreenState extends ConsumerState<LinenLossScreen> {
  int? _itemId;
  String _kind = 'LOST';
  int _quantity = 1;
  final _note = TextEditingController();
  String? _error;

  @override
  void initState() {
    super.initState();
    _itemId = widget.item?.id;
  }

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_itemId == null) {
      setState(() => _error = 'Choose the item.');
      return;
    }
    final ok = await ref.read(laundryViewModelProvider.notifier).recordLoss({
      'linenItemId': _itemId,
      'kind': _kind,
      'quantity': _quantity,
      'note': _note.text.trim(),
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

    return Scaffold(
      appBar: AppBar(title: const Text('Lost or damaged linen')),
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
                  const RequiredLabel('Item'),
                  const SizedBox(height: AppTheme.s8),
                  OptionDropdown(
                    values: items.map((i) => '${i.id}').toList(),
                    labels: {for (final i in items) '${i.id}': i.name},
                    selected: _itemId?.toString(),
                    onSelect: (v) => setState(() => _itemId = int.parse(v)),
                  ),
                  const SizedBox(height: AppTheme.s16),
                  ToggleGroup(
                    options: const {'LOST': 'Lost', 'DAMAGED': 'Damaged'},
                    selected: _kind,
                    onSelect: (v) => setState(() => _kind = v),
                  ),
                  const SizedBox(height: AppTheme.s16),
                  Row(
                    children: [
                      const Text('How many', style: TextStyle(color: AppTheme.text, fontSize: 13.5)),
                      const Spacer(),
                      CountStepper(value: _quantity, onChange: (n) => setState(() => _quantity = n < 1 ? 1 : n)),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s16),
                  NeuField(controller: _note, label: 'Note (optional)'),
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
                  : const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }
}
