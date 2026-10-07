import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/laundry.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'laundry_parts.dart';

/// Add or edit one linen type — mirrors the 'item' modal in
/// LaundryPanel.jsx's LinenTab: a name and how many are owned in total.
Future<void> showLinenItemFormScreen(BuildContext context, {LinenItem? item, String? startingName}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => LinenItemFormScreen(item: item, startingName: startingName)),
  );
}

const _starters = ['Bedsheet', 'Pillow cover', 'Towel', 'Bath towel', 'Blanket'];

class LinenItemFormScreen extends ConsumerStatefulWidget {
  final LinenItem? item;
  final String? startingName;

  const LinenItemFormScreen({super.key, this.item, this.startingName});

  @override
  ConsumerState<LinenItemFormScreen> createState() => _LinenItemFormScreenState();
}

class _LinenItemFormScreenState extends ConsumerState<LinenItemFormScreen> {
  bool get _isEdit => widget.item != null;
  late final _name = TextEditingController(text: widget.item?.name ?? widget.startingName ?? '');
  late final _owned = TextEditingController(text: widget.item == null ? '' : widget.item!.totalOwned.toString());
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _owned.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a name.');
      return;
    }
    final vm = ref.read(laundryViewModelProvider.notifier);
    final ok = await vm.saveLinenItem(
      {'name': _name.text.trim(), 'totalOwned': num.tryParse(_owned.text.trim()) ?? 0},
      id: widget.item?.id,
    );
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(laundryViewModelProvider).error ?? 'Could not save this linen type.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(laundryViewModelProvider);
    final hidden = state.hiddenItems;
    final existingNames = state.board.items.map((i) => i.name.toLowerCase()).toSet();
    final suggestions = _starters.where((s) => !existingNames.contains(s.toLowerCase())).toList();

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit linen item' : 'Add linen item')),
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
                  if (!_isEdit && hidden.isNotEmpty) ...[
                    const Text('Bring back', style: TextStyle(color: AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w600)),
                    const SizedBox(height: AppTheme.s8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final h in hidden)
                          ActionChip(
                            label: Text(h.name),
                            onPressed: state.submitting
                                ? null
                                : () async {
                                    final ok = await ref.read(laundryViewModelProvider.notifier).setLinenItemActive(h.id, true);
                                    if (!mounted) return;
                                    if (ok) Navigator.pop(context);
                                  },
                          ),
                      ],
                    ),
                    const SizedBox(height: AppTheme.s16),
                  ],
                  if (!_isEdit && suggestions.isNotEmpty) ...[
                    const Text('Common types', style: TextStyle(color: AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w600)),
                    const SizedBox(height: AppTheme.s8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final s in suggestions) ActionChip(label: Text(s), onPressed: () => setState(() => _name.text = s)),
                      ],
                    ),
                    const SizedBox(height: AppTheme.s16),
                  ],
                  NeuField(controller: _name, label: 'Name', required: true, hint: 'Bedsheet', forceCapitalizeWords: true),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _owned, label: 'How many do you own in total?', keyboardType: TextInputType.number),
                  const SizedBox(height: AppTheme.s4),
                  const Text('Count everything: in rooms, in the store and in the wash.', style: TextStyle(color: AppTheme.muted, fontSize: 11.5)),
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
