import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../../widgets/photo_source_sheet.dart';
import '../theme.dart';

/// Register or edit an asset. Mirrors the register form in AssetsPanel.jsx,
/// including its recent Single/Bulk toggle — bulk mode files one purchase
/// (one category, one vendor, one bill) as several units.
Future<void> showAssetFormSheet(BuildContext context, {Asset? asset}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (_) => AssetFormScreen(asset: asset)),
  );
}

class AssetFormScreen extends ConsumerStatefulWidget {
  final Asset? asset;
  const AssetFormScreen({super.key, this.asset});

  @override
  ConsumerState<AssetFormScreen> createState() => _AssetFormScreenState();
}

class _BulkUnit {
  final name = TextEditingController();
  final serialNumber = TextEditingController();
  final floor = TextEditingController();
  final department = TextEditingController();
  final locationNote = TextEditingController();

  void dispose() {
    name.dispose();
    serialNumber.dispose();
    floor.dispose();
    department.dispose();
    locationNote.dispose();
  }
}

class _AssetFormScreenState extends ConsumerState<AssetFormScreen> {
  bool get _isEdit => widget.asset != null;

  bool _bulk = false;

  int? _categoryId;
  int? _vendorId;
  late final _name = TextEditingController(text: widget.asset?.name ?? '');
  late final _brand = TextEditingController(text: widget.asset?.brand ?? '');
  late final _model = TextEditingController(text: widget.asset?.model ?? '');
  late final _serialNumber = TextEditingController(text: widget.asset?.serialNumber ?? '');
  late final _purchaseDate = TextEditingController(text: widget.asset?.purchaseDate ?? '');
  late final _purchaseCost = TextEditingController(text: widget.asset?.purchaseCost?.toString() ?? '');
  late final _floor = TextEditingController(text: widget.asset?.floor ?? '');
  late final _department = TextEditingController(text: widget.asset?.department ?? '');
  late final _locationNote = TextEditingController(text: widget.asset?.locationNote ?? '');
  late final _warrantyExpiry = TextEditingController(text: widget.asset?.warrantyExpiry ?? '');

  final List<_BulkUnit> _units = [_BulkUnit()];

  XFile? _billPhoto;
  String? _error;

  @override
  void initState() {
    super.initState();
    _categoryId = widget.asset?.categoryId;
    _vendorId = widget.asset?.vendorId;
    Future.microtask(() => ref.read(assetsViewModelProvider.notifier).loadCatalogue());
  }

  @override
  void dispose() {
    _name.dispose();
    _brand.dispose();
    _model.dispose();
    _serialNumber.dispose();
    _purchaseDate.dispose();
    _purchaseCost.dispose();
    _floor.dispose();
    _department.dispose();
    _locationNote.dispose();
    _warrantyExpiry.dispose();
    for (final u in _units) {
      u.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate(TextEditingController controller) async {
    final now = DateTime.now();
    final initial = DateTime.tryParse(controller.text) ?? now;
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 15),
      lastDate: DateTime(now.year + 15),
      initialDate: initial,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      controller.text =
          '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    });
  }

  Future<void> _pickBillPhoto() async {
    final source = await showPhotoSourceSheet(context, title: 'Add the bill', subtitle: 'Take a photo or pick one from your gallery');
    if (source == null) return;
    final photo = await ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 1600);
    if (photo != null) setState(() => _billPhoto = photo);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(assetsViewModelProvider);
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit asset' : 'Register an asset')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            if (!_isEdit) ...[
              _ModeToggle(bulk: _bulk, onChange: (v) => setState(() => _bulk = v)),
              const SizedBox(height: AppTheme.s16),
            ],
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_error != null) ...[
                    _ErrorBanner(_error!),
                    const SizedBox(height: AppTheme.s16),
                  ],
                  const Text('Category', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: 4),
                  NeuPressed(
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<int>(
                        isExpanded: true,
                        value: _categoryId,
                        dropdownColor: AppTheme.card,
                        hint: const Text('Choose a category', style: TextStyle(color: AppTheme.muted, fontSize: 13.5)),
                        items: [
                          for (final c in state.activeCategories)
                            DropdownMenuItem(value: c.id, child: Text(c.name, style: const TextStyle(fontSize: 13.5))),
                        ],
                        onChanged: (v) => setState(() => _categoryId = v),
                      ),
                    ),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  if (!_bulk || _isEdit) ...[
                    NeuField(controller: _name, label: 'Name', hint: 'Split AC 1.5T', required: true),
                    const SizedBox(height: AppTheme.s12),
                  ],
                  Row(
                    children: [
                      Expanded(child: NeuField(controller: _brand, label: 'Brand', hint: 'Voltas')),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(child: NeuField(controller: _model, label: 'Model', hint: 'SAC183')),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s12),
                  if (!_bulk || _isEdit) ...[
                    NeuField(controller: _serialNumber, label: 'Serial number', hint: 'Optional'),
                    const SizedBox(height: AppTheme.s12),
                  ],
                  Row(
                    children: [
                      Expanded(
                        child: NeuField(
                          controller: _purchaseDate,
                          label: 'Purchase date',
                          hint: 'Tap to pick',
                          readOnly: true,
                          onTap: () => _pickDate(_purchaseDate),
                        ),
                      ),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(child: NeuField(controller: _purchaseCost, label: 'Purchase cost', keyboardType: TextInputType.number)),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s12),
                  const Text('Vendor (optional)', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: 4),
                  NeuPressed(
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<int?>(
                        isExpanded: true,
                        value: _vendorId,
                        dropdownColor: AppTheme.card,
                        hint: const Text('No vendor', style: TextStyle(color: AppTheme.muted, fontSize: 13.5)),
                        items: [
                          const DropdownMenuItem(value: null, child: Text('No vendor', style: TextStyle(fontSize: 13.5))),
                          for (final v in state.activeVendors)
                            DropdownMenuItem(value: v.id, child: Text(v.name, style: const TextStyle(fontSize: 13.5))),
                        ],
                        onChanged: (v) => setState(() => _vendorId = v),
                      ),
                    ),
                  ),
                  if (!_isEdit) ...[
                    const SizedBox(height: AppTheme.s12),
                    NeuField(
                      controller: _warrantyExpiry,
                      label: 'Warranty until (optional)',
                      hint: 'Tap to pick',
                      readOnly: true,
                      onTap: () => _pickDate(_warrantyExpiry),
                    ),
                  ],
                  if (!_bulk || _isEdit) ...[
                    const SizedBox(height: AppTheme.s12),
                    Row(
                      children: [
                        Expanded(child: NeuField(controller: _floor, label: 'Floor', hint: '1')),
                        const SizedBox(width: AppTheme.s8),
                        Expanded(child: NeuField(controller: _department, label: 'Department', hint: 'Housekeeping')),
                      ],
                    ),
                    const SizedBox(height: AppTheme.s12),
                    NeuField(controller: _locationNote, label: 'Location note', hint: 'Room 204, near window'),
                  ],
                  const SizedBox(height: AppTheme.s16),
                  const Text('Bill (optional)', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: AppTheme.s8),
                  Row(
                    children: [
                      if (_billPhoto != null)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(AppTheme.rSmall),
                          child: Image.file(File(_billPhoto!.path), width: 56, height: 56, fit: BoxFit.cover),
                        )
                      else if (_isEdit && widget.asset!.hasBillDocument)
                        Container(
                          width: 56,
                          height: 56,
                          decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(AppTheme.rSmall), border: Border.all(color: AppTheme.border)),
                          child: const Icon(Icons.receipt_long_rounded, color: AppTheme.muted),
                        ),
                      const SizedBox(width: AppTheme.s8),
                      NeuButton(onPressed: _pickBillPhoto, child: Text(_billPhoto == null ? 'Add photo' : 'Replace photo')),
                    ],
                  ),
                ],
              ),
            ),
            if (_bulk && !_isEdit) ...[
              const SizedBox(height: AppTheme.s16),
              NeuCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Text('Units', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
                        ),
                        Text('${_units.length}', style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
                      ],
                    ),
                    const SizedBox(height: AppTheme.s8),
                    for (var i = 0; i < _units.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppTheme.s12),
                        child: Container(
                          padding: const EdgeInsets.all(AppTheme.s12),
                          decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(AppTheme.rSmall), border: Border.all(color: AppTheme.border)),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(child: Text('Unit ${i + 1}', style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13))),
                                  if (_units.length > 1)
                                    IconButton(
                                      icon: const Icon(Icons.close_rounded, size: 18),
                                      color: AppTheme.muted,
                                      onPressed: () => setState(() {
                                        _units[i].dispose();
                                        _units.removeAt(i);
                                      }),
                                    ),
                                ],
                              ),
                              NeuField(controller: _units[i].name, label: 'Name', hint: 'Split AC 1.5T · Room 101', required: true),
                              const SizedBox(height: AppTheme.s8),
                              NeuField(controller: _units[i].serialNumber, label: 'Serial number (optional)'),
                              const SizedBox(height: AppTheme.s8),
                              Row(
                                children: [
                                  Expanded(child: NeuField(controller: _units[i].floor, label: 'Floor')),
                                  const SizedBox(width: AppTheme.s8),
                                  Expanded(child: NeuField(controller: _units[i].department, label: 'Department')),
                                ],
                              ),
                              const SizedBox(height: AppTheme.s8),
                              NeuField(controller: _units[i].locationNote, label: 'Location note'),
                            ],
                          ),
                        ),
                      ),
                    NeuButton(
                      expand: true,
                      onPressed: () => setState(() => _units.add(_BulkUnit())),
                      padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                      child: const Text('+ Add another unit'),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: state.submitting ? null : _submit,
              child: state.submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(_isEdit ? 'Save changes' : (_bulk ? 'Register units' : 'Register asset')),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    setState(() => _error = null);
    if (_categoryId == null) {
      setState(() => _error = 'Choose a category.');
      return;
    }

    final vm = ref.read(assetsViewModelProvider.notifier);

    if (_bulk && !_isEdit) {
      if (_units.any((u) => u.name.text.trim().isEmpty)) {
        setState(() => _error = 'Every unit needs a name.');
        return;
      }
      final formMap = <String, dynamic>{
        'categoryId': '$_categoryId',
        'brand': _brand.text.trim(),
        'model': _model.text.trim(),
        'purchaseDate': _purchaseDate.text.trim(),
        'purchaseCost': _purchaseCost.text.trim().isEmpty ? '' : (num.tryParse(_purchaseCost.text.trim()) ?? '').toString(),
        'vendorId': _vendorId?.toString() ?? '',
        'warrantyExpiry': _warrantyExpiry.text.trim(),
        'units': _unitsJson(),
      };
      if (_billPhoto != null) {
        formMap['bill'] = dio.MultipartFile.fromFileSync(_billPhoto!.path, filename: _billPhoto!.name);
      }
      final ok = await vm.saveAssetsBulk(dio.FormData.fromMap(formMap));
      if (!mounted) return;
      if (ok) {
        Navigator.pop(context);
      } else {
        setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not register these units.');
      }
      return;
    }

    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a name for the asset.');
      return;
    }
    final formMap = <String, dynamic>{
      'name': _name.text.trim(),
      'categoryId': '$_categoryId',
      'brand': _brand.text.trim(),
      'model': _model.text.trim(),
      'serialNumber': _serialNumber.text.trim(),
      'purchaseDate': _purchaseDate.text.trim(),
      'purchaseCost': _purchaseCost.text.trim().isEmpty ? '' : (num.tryParse(_purchaseCost.text.trim()) ?? '').toString(),
      'floor': _floor.text.trim(),
      'department': _department.text.trim(),
      'locationNote': _locationNote.text.trim(),
      'vendorId': _vendorId?.toString() ?? '',
      if (!_isEdit) 'warrantyExpiry': _warrantyExpiry.text.trim(),
    };
    if (_billPhoto != null) {
      formMap['bill'] = dio.MultipartFile.fromFileSync(_billPhoto!.path, filename: _billPhoto!.name);
    }
    final ok = await vm.saveAsset(dio.FormData.fromMap(formMap), id: widget.asset?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not save the asset.');
    }
  }

  String _unitsJson() => jsonEncode(_units
      .map((u) => {
            'name': u.name.text.trim(),
            'serialNumber': u.serialNumber.text.trim(),
            'floor': u.floor.text.trim(),
            'department': u.department.text.trim(),
            'locationNote': u.locationNote.text.trim(),
          })
      .toList());
}

class _ModeToggle extends StatelessWidget {
  final bool bulk;
  final ValueChanged<bool> onChange;

  const _ModeToggle({required this.bulk, required this.onChange});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(999), border: Border.all(color: AppTheme.border)),
      child: Row(
        children: [
          Expanded(child: _segment('Single', !bulk, () => onChange(false))),
          Expanded(child: _segment('Bulk', bulk, () => onChange(true))),
        ],
      ),
    );
  }

  Widget _segment(String label, bool selected, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
        decoration: BoxDecoration(color: selected ? AppTheme.accent : Colors.transparent, borderRadius: BorderRadius.circular(999)),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(color: selected ? Colors.white : AppTheme.text, fontWeight: selected ? FontWeight.w600 : FontWeight.w500, fontSize: 13),
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
