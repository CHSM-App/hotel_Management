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
    // A loss is always taken from the store, so it can't exceed what is clean
    // and in the store right now — the server enforces the same ceiling.
    final selected = items.where((i) => i.id == _itemId).firstOrNull;
    final maxQty = selected?.clean;
    if (maxQty != null && maxQty >= 1 && _quantity > maxQty) _quantity = maxQty;


    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Lost or damaged linen',
          overflow: TextOverflow.ellipsis,
          maxLines: 1,
        ),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s16),
              children: [
                if (_error != null) ...[
                  ErrorBanner(_error!),
                  const SizedBox(height: AppTheme.s12),
                ],
                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.elevated,
                  padding: const EdgeInsets.all(AppTheme.s16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SectionLabel('Linen item', number: 1, icon: Icons.bed_rounded),
                      const SizedBox(height: AppTheme.s12),
                      const RequiredLabel('Item'),
                      const SizedBox(height: AppTheme.s8),
                      OptionDropdown(
                        values: items.map((i) => '${i.id}').toList(),
                        labels: {for (final i in items) '${i.id}': '${i.name} (${i.clean} clean)'},
                        selected: _itemId?.toString(),
                        hint: 'Choose…',
                        onSelect: (v) => setState(() {
                          _itemId = int.parse(v);
                          final clean = items.where((i) => i.id == _itemId).firstOrNull?.clean;
                          if (clean != null && clean >= 1 && _quantity > clean) _quantity = clean;
                        }),
                      ),
                      if (selected != null) ...[
                        const SizedBox(height: AppTheme.s8),
                        Text(
                          '${selected.clean} clean and in the store — a loss can only be taken from these.',
                          style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                        ),
                      ],
                      const SectionDivider(),
                      const SectionLabel('What happened', number: 2, icon: Icons.help_outline_rounded),
                      const SizedBox(height: AppTheme.s12),
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
                          CountStepper(
                            value: _quantity,
                            max: maxQty != null && maxQty >= 1 ? maxQty : 999999,
                            onChange: (n) => setState(() => _quantity = n < 1 ? 1 : n),
                          ),
                        ],
                      ),
                      const SectionDivider(),
                      const SectionLabel('Note', number: 3, icon: Icons.notes_rounded),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(controller: _note, label: 'Note (optional)', dense: true),
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s16),
                Row(
                  children: [
                    Expanded(
                      child: NeuButton(
                        onPressed: state.submitting ? null : () => Navigator.of(context).pop(),
                        padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                        child: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    Expanded(
                      flex: 2,
                      child: NeuButton(
                        primary: true,
                        onPressed: state.submitting ? null : _submit,
                        padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                        child: state.submitting
                            ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Text('Save'),
                      ),
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
