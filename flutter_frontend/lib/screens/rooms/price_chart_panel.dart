import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/category.dart';
import '../../domain/models/season.dart';
import '../../domain/models/switchable_charge_listing.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// The rate chart — categories, booking extras and seasons — the same three
/// sections web's PriceChartPanel.jsx shows, against the same three
/// endpoints (/categories, /switchable-charges, /seasons).
class PriceChartPanel extends ConsumerWidget {
  const PriceChartPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(roomsViewModelProvider);

    return RefreshIndicator(
      onRefresh: () => ref.read(roomsViewModelProvider.notifier).loadAll(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s4, AppTheme.s16, AppTheme.s32),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          _Section(
            title: 'Categories',
            hint: 'Base price is the cheapest version of that room',
            child: _CategoriesSection(categories: state.categories),
          ),
          const SizedBox(height: 20),
          _Section(
            title: 'Booking extras',
            hint: 'Optional add-ons staff can check off for a guest',
            child: _ChargesSection(charges: state.switchableCharges),
          ),
          const SizedBox(height: 20),
          _Section(
            title: 'Seasons',
            hint: 'Paint festivals and weekends onto the calendar',
            child: _SeasonsSection(seasons: state.seasons),
          ),
        ],
      ),
    );
  }
}

// ── Section shell ────────────────────────────────────────────────────────────

class _Section extends StatelessWidget {
  final String title;
  final String hint;
  final Widget child;

  const _Section({required this.title, required this.hint, required this.child});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 2),
          Text(hint, style: const TextStyle(color: AppTheme.muted, fontSize: 11)),
          const SizedBox(height: AppTheme.s12),
          child,
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String name;
  final bool? isActive;
  final String value;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _Row({
    required this.name,
    this.isActive,
    required this.value,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    name,
                    style: const TextStyle(color: AppTheme.heading, fontSize: 13),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (isActive == false) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.muted.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: const Text('Inactive', style: TextStyle(color: AppTheme.muted, fontSize: 10)),
                  ),
                ],
              ],
            ),
          ),
          Text(value, style: const TextStyle(color: AppTheme.text, fontSize: 13)),
          IconButton(
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.edit_outlined, size: 16),
            color: AppTheme.muted,
            onPressed: onEdit,
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.delete_outline_rounded, size: 16),
            color: AppTheme.danger,
            onPressed: onDelete,
          ),
        ],
      ),
    );
  }
}

Future<void> _say(BuildContext context, String message) async {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), backgroundColor: AppTheme.heading),
  );
}

Future<bool> _confirmDeleteChoice(
  BuildContext context, {
  required String title,
  required bool isActive,
}) async {
  final choice = await showModalBottomSheet<String>(
    context: context,
    backgroundColor: AppTheme.bg,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.rLarge)),
    ),
    builder: (context) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: AppTheme.s16),
          Text('Delete $title', style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w500, fontSize: 16)),
          const SizedBox(height: AppTheme.s16),
          ListTile(
            title: Text(isActive ? 'Deactivate' : 'Activate'),
            subtitle: Text(
              isActive
                  ? 'Hide it from new bookings/rooms, but keep its history.'
                  : 'Make it available again.',
            ),
            onTap: () => Navigator.pop(context, 'deactivate'),
          ),
          ListTile(
            title: const Text('Permanently delete', style: TextStyle(color: AppTheme.danger)),
            subtitle: const Text("Remove it completely. This can't be undone, and only works if it's unused."),
            onTap: () => Navigator.pop(context, 'delete'),
          ),
          const SizedBox(height: AppTheme.s8),
        ],
      ),
    ),
  );
  return choice == 'delete';
}

// ── Categories ───────────────────────────────────────────────────────────────

class _CategoriesSection extends ConsumerStatefulWidget {
  final List<RoomCategory> categories;
  const _CategoriesSection({required this.categories});

  @override
  ConsumerState<_CategoriesSection> createState() => _CategoriesSectionState();
}

class _CategoriesSectionState extends ConsumerState<_CategoriesSection> {
  final _name = TextEditingController();
  final _price = TextEditingController();
  int? _editingId;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _price.dispose();
    super.dispose();
  }

  void _edit(RoomCategory c) {
    setState(() {
      _editingId = c.id;
      _name.text = c.name;
      _price.text = '${c.basePrice}';
      _error = null;
    });
  }

  void _cancelEdit() {
    setState(() {
      _editingId = null;
      _name.clear();
      _price.clear();
      _error = null;
    });
  }

  Future<void> _submit() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a category name.');
      return;
    }
    final price = num.tryParse(_price.text.trim());
    if (price == null || price <= 0) {
      setState(() => _error = 'Enter a base price greater than 0.');
      return;
    }
    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = await vm.saveCategory(id: _editingId, name: _name.text.trim(), basePrice: price);
    if (!mounted) return;
    if (ok) {
      _cancelEdit();
    } else {
      setState(() => _error = ref.read(roomsViewModelProvider).error ?? 'Could not save the category.');
    }
  }

  Future<void> _delete(RoomCategory c) async {
    final permanent = await _confirmDeleteChoice(context, title: c.name, isActive: c.isActive);
    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = permanent ? await vm.deleteCategory(c.id) : await vm.setCategoryActive(c.id, !c.isActive);
    if (!mounted) return;
    if (!ok) _say(context, ref.read(roomsViewModelProvider).error ?? 'Could not update this category.');
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(roomsViewModelProvider).submitting;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final c in widget.categories)
          _Row(
            name: c.name,
            isActive: c.isActive,
            value: formatPrice(c.basePrice),
            onEdit: () => _edit(c),
            onDelete: () => _delete(c),
          ),
        const SizedBox(height: AppTheme.s8),
        if (_error != null) ...[
          Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
          const SizedBox(height: AppTheme.s8),
        ],
        Row(
          children: [
            Expanded(
              child: NeuField(controller: _name, label: '', hint: 'Deluxe'),
            ),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: NeuField(
                controller: _price,
                label: '',
                hint: 'Base price ₹',
                keyboardType: TextInputType.number,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        Row(
          children: [
            Expanded(
              child: NeuButton(
                onPressed: submitting ? null : _submit,
                child: Text(_editingId != null ? 'Save' : 'Add'),
              ),
            ),
            if (_editingId != null) ...[
              const SizedBox(width: AppTheme.s8),
              TextButton(onPressed: _cancelEdit, child: const Text('Cancel')),
            ],
          ],
        ),
      ],
    );
  }
}

// ── Booking extras ───────────────────────────────────────────────────────────

class _ChargesSection extends ConsumerStatefulWidget {
  final List<SwitchableChargeListing> charges;
  const _ChargesSection({required this.charges});

  @override
  ConsumerState<_ChargesSection> createState() => _ChargesSectionState();
}

class _ChargesSectionState extends ConsumerState<_ChargesSection> {
  final _name = TextEditingController();
  final _amount = TextEditingController();
  int? _editingId;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _amount.dispose();
    super.dispose();
  }

  void _edit(SwitchableChargeListing c) {
    setState(() {
      _editingId = c.id;
      _name.text = c.name;
      _amount.text = '${c.chargePerNight}';
      _error = null;
    });
  }

  void _cancelEdit() {
    setState(() {
      _editingId = null;
      _name.clear();
      _amount.clear();
      _error = null;
    });
  }

  Future<void> _submit() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a charge name.');
      return;
    }
    final amount = num.tryParse(_amount.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter an amount greater than 0.');
      return;
    }
    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = await vm.saveSwitchableCharge(id: _editingId, name: _name.text.trim(), chargePerNight: amount);
    if (!mounted) return;
    if (ok) {
      _cancelEdit();
    } else {
      setState(() => _error = ref.read(roomsViewModelProvider).error ?? 'Could not save the extra.');
    }
  }

  Future<void> _delete(SwitchableChargeListing c) async {
    final permanent = await _confirmDeleteChoice(context, title: c.name, isActive: c.isActive);
    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = permanent ? await vm.deleteSwitchableCharge(c.id) : await vm.setSwitchableChargeActive(c.id, !c.isActive);
    if (!mounted) return;
    if (!ok) _say(context, ref.read(roomsViewModelProvider).error ?? 'Could not update this extra.');
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(roomsViewModelProvider).submitting;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final c in widget.charges)
          _Row(
            name: c.name,
            isActive: c.isActive,
            value: '${formatPrice(c.chargePerNight)}/night',
            onEdit: () => _edit(c),
            onDelete: () => _delete(c),
          ),
        const SizedBox(height: AppTheme.s8),
        if (_error != null) ...[
          Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
          const SizedBox(height: AppTheme.s8),
        ],
        Row(
          children: [
            Expanded(child: NeuField(controller: _name, label: '', hint: 'AC')),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: NeuField(
                controller: _amount,
                label: '',
                hint: 'Amount ₹/night',
                keyboardType: TextInputType.number,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        Row(
          children: [
            Expanded(
              child: NeuButton(
                onPressed: submitting ? null : _submit,
                child: Text(_editingId != null ? 'Save' : 'Add'),
              ),
            ),
            if (_editingId != null) ...[
              const SizedBox(width: AppTheme.s8),
              TextButton(onPressed: _cancelEdit, child: const Text('Cancel')),
            ],
          ],
        ),
      ],
    );
  }
}

// ── Seasons ──────────────────────────────────────────────────────────────────

class _SeasonsSection extends ConsumerStatefulWidget {
  final List<Season> seasons;
  const _SeasonsSection({required this.seasons});

  @override
  ConsumerState<_SeasonsSection> createState() => _SeasonsSectionState();
}

class _SeasonsSectionState extends ConsumerState<_SeasonsSection> {
  final _name = TextEditingController();
  final _adjustment = TextEditingController();
  DateTime _startDate = DateTime.now();
  DateTime _endDate = DateTime.now();
  int? _editingId;
  String? _error;

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  void dispose() {
    _name.dispose();
    _adjustment.dispose();
    super.dispose();
  }

  void _edit(Season s) {
    setState(() {
      _editingId = s.id;
      _name.text = s.name;
      _adjustment.text = '${s.adjustmentPercent}';
      _startDate = DateTime.tryParse(s.startDate) ?? DateTime.now();
      _endDate = DateTime.tryParse(s.endDate) ?? DateTime.now();
      _error = null;
    });
  }

  void _cancelEdit() {
    setState(() {
      _editingId = null;
      _name.clear();
      _adjustment.clear();
      _startDate = DateTime.now();
      _endDate = DateTime.now();
      _error = null;
    });
  }

  Future<void> _pickDate({required bool start}) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: start ? _startDate : _endDate,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 730)),
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
    setState(() => start ? _startDate = picked : _endDate = picked);
  }

  Future<void> _submit() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a season name.');
      return;
    }
    final adjustment = num.tryParse(_adjustment.text.trim());
    if (adjustment == null) {
      setState(() => _error = 'Enter an adjustment percentage.');
      return;
    }
    if (_endDate.isBefore(_startDate)) {
      setState(() => _error = 'End date must be on or after the start date.');
      return;
    }
    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = await vm.saveSeason(
      id: _editingId,
      name: _name.text.trim(),
      startDate: _iso(_startDate),
      endDate: _iso(_endDate),
      adjustmentPercent: adjustment,
    );
    if (!mounted) return;
    if (ok) {
      _cancelEdit();
    } else {
      setState(() => _error = ref.read(roomsViewModelProvider).error ?? 'Could not save the season.');
    }
  }

  Future<void> _delete(Season s) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: Text('Delete ${s.name}?', style: const TextStyle(color: AppTheme.heading)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    );
    if (sure != true) return;
    final ok = await ref.read(roomsViewModelProvider.notifier).deleteSeason(s.id);
    if (!mounted) return;
    if (!ok) _say(context, ref.read(roomsViewModelProvider).error ?? 'Could not delete this season.');
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(roomsViewModelProvider).submitting;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final s in widget.seasons)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(s.name, style: const TextStyle(color: AppTheme.heading, fontSize: 13)),
                      Text(
                        '${s.startDate} → ${s.endDate}',
                        style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                Text(
                  '${s.adjustmentPercent > 0 ? '+' : ''}${s.adjustmentPercent}%',
                  style: const TextStyle(color: AppTheme.text, fontSize: 13),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  color: AppTheme.muted,
                  onPressed: () => _edit(s),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.delete_outline_rounded, size: 16),
                  color: AppTheme.danger,
                  onPressed: () => _delete(s),
                ),
              ],
            ),
          ),
        const SizedBox(height: AppTheme.s8),
        if (_error != null) ...[
          Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
          const SizedBox(height: AppTheme.s8),
        ],
        NeuField(controller: _name, label: '', hint: 'Diwali'),
        const SizedBox(height: AppTheme.s8),
        Row(
          children: [
            Expanded(
              child: GestureDetector(
                onTap: () => _pickDate(start: true),
                child: NeuPressed(
                  child: Text(_iso(_startDate), style: const TextStyle(color: AppTheme.text, fontSize: 13)),
                ),
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: GestureDetector(
                onTap: () => _pickDate(start: false),
                child: NeuPressed(
                  child: Text(_iso(_endDate), style: const TextStyle(color: AppTheme.text, fontSize: 13)),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.s8),
        NeuField(
          controller: _adjustment,
          label: '',
          hint: '+% adjustment',
          keyboardType: const TextInputType.numberWithOptions(signed: true, decimal: true),
        ),
        const SizedBox(height: AppTheme.s8),
        Row(
          children: [
            Expanded(
              child: NeuButton(
                onPressed: submitting ? null : _submit,
                child: Text(_editingId != null ? 'Save' : 'Add'),
              ),
            ),
            if (_editingId != null) ...[
              const SizedBox(width: AppTheme.s8),
              TextButton(onPressed: _cancelEdit, child: const Text('Cancel')),
            ],
          ],
        ),
      ],
    );
  }
}
