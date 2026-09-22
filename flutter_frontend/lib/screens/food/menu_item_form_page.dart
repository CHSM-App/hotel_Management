import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/constant.dart';
import '../../domain/models/menu.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../../widgets/photo_source_sheet.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

const _kFoodTypes = [
  ('VEG', 'Veg'),
  ('NON_VEG', 'Non-veg'),
];

class _PortionRow {
  final _label = TextEditingController();
  final _price = TextEditingController();
  _PortionRow({String label = '', String price = ''}) {
    _label.text = label;
    _price.text = price;
  }
  void dispose() {
    _label.dispose();
    _price.dispose();
  }
}

/// Add or edit a dish — mirrors MenuPanel.jsx's item dialog: section, name,
/// veg/non-veg mark, description, one photo, and either a single price or a
/// list of sizes. Same numbered-section framing as the Rooms form
/// (add_room_page.dart) so the two full-page forms in this app read as one
/// system rather than two different form languages.
Future<void> showMenuItemFormPage(
  BuildContext context, {
  required List<MenuSection> sections,
  MenuItem? item,
  int? defaultCategoryId,
}) {
  return Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => MenuItemFormPage(
        sections: sections,
        item: item,
        defaultCategoryId: defaultCategoryId,
      ),
    ),
  );
}

class MenuItemFormPage extends ConsumerStatefulWidget {
  final List<MenuSection> sections;
  final MenuItem? item;
  final int? defaultCategoryId;

  const MenuItemFormPage({super.key, required this.sections, this.item, this.defaultCategoryId});

  @override
  ConsumerState<MenuItemFormPage> createState() => _MenuItemFormPageState();
}

class _MenuItemFormPageState extends ConsumerState<MenuItemFormPage> {
  late final _name = TextEditingController(text: widget.item?.name ?? '');
  late final _description = TextEditingController(text: widget.item?.description ?? '');
  late final _price = TextEditingController(text: widget.item != null ? '${widget.item!.price}' : '');
  late final _sortOrder = TextEditingController(text: widget.item?.sortOrder.toString() ?? '');

  int? _categoryId;
  String _foodType = 'VEG';
  final List<_PortionRow> _portions = [];
  XFile? _newPhoto;
  bool _removeImage = false;
  String? _error;
  bool _submitAttempted = false;

  bool get _editing => widget.item != null;
  bool get _hasSizes => _portions.any((p) => p._label.text.trim().isNotEmpty);

  String? get _categoryError => (_submitAttempted && _categoryId == null) ? 'Choose a menu section.' : null;
  String? get _nameError => (_submitAttempted && _name.text.trim().isEmpty) ? 'Item name is required.' : null;

  @override
  void initState() {
    super.initState();
    final item = widget.item;
    _categoryId = item?.categoryId ?? widget.defaultCategoryId;
    _foodType = item?.foodType ?? 'VEG';
    for (final p in item?.portions ?? const []) {
      _portions.add(_PortionRow(label: p.label, price: '${p.price}'));
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _price.dispose();
    _sortOrder.dispose();
    for (final p in _portions) {
      p.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(menuViewModelProvider).submitting;

    return Scaffold(
      appBar: AppBar(title: Text(_editing ? 'Edit dish' : 'Add a dish')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, AppTheme.s12),
          children: [
            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(AppTheme.s8),
                decoration: BoxDecoration(
                  color: AppTheme.danger.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(AppTheme.rSmall),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 13)),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s8),
            ],

            NeuCard(
              padding: const EdgeInsets.all(AppTheme.s8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Section & name', number: 1),
                  const SizedBox(height: AppTheme.s8),
                  const RequiredLabel('Section'),
                  const SizedBox(height: 4),
                  OptionDropdown(
                    values: [for (final s in widget.sections) '${s.id}'],
                    labels: {for (final s in widget.sections) '${s.id}': s.name},
                    selected: widget.sections.any((s) => s.id == _categoryId) ? '$_categoryId' : null,
                    hint: 'Choose a section',
                    hasError: _categoryError != null,
                    onSelect: (v) => setState(() => _categoryId = int.parse(v)),
                  ),
                  if (_categoryError != null) ...[
                    const SizedBox(height: AppTheme.s4),
                    Text(_categoryError!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                  ],
                  const SizedBox(height: AppTheme.s8),
                  NeuField(
                    controller: _name,
                    label: 'Dish name',
                    hint: 'Paneer butter masala',
                    required: true,
                    errorText: _nameError,
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: AppTheme.s8),
                  const Text('Type', style: TextStyle(color: AppTheme.muted, fontSize: 13)),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      for (final (key, label) in _kFoodTypes)
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(right: AppTheme.s8),
                            child: _FoodTypeChoice(
                              label: label,
                              isVeg: key == 'VEG',
                              selected: _foodType == key,
                              onTap: () => setState(() => _foodType = key),
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s8),

            NeuCard(
              padding: const EdgeInsets.all(AppTheme.s8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Description & photo', number: 2),
                  const SizedBox(height: AppTheme.s8),
                  NeuField(
                    controller: _description,
                    label: 'Description (optional)',
                    hint: 'Paneer cooked in rich tomato, butter and cream gravy.',
                    maxLength: 300,
                  ),
                  const SizedBox(height: AppTheme.s8),
                  const Text('Photo', style: TextStyle(color: AppTheme.muted, fontSize: 13)),
                  const SizedBox(height: 4),
                  _photoPicker(),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s8),

            NeuCard(
              padding: const EdgeInsets.all(AppTheme.s8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Expanded(child: SectionLabel('Pricing', number: 3)),
                      TextButton.icon(
                        onPressed: () => setState(() => _portions.add(_PortionRow())),
                        icon: const Icon(Icons.add_rounded, size: 16),
                        label: const Text('Add a size'),
                      ),
                    ],
                  ),
                  for (var i = 0; i < _portions.length; i++)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppTheme.s8),
                      child: Row(
                        children: [
                          Expanded(
                            flex: 3,
                            child: NeuField(
                              controller: _portions[i]._label,
                              label: '',
                              hint: i == 0 ? 'Half plate' : 'Full plate',
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(
                            flex: 2,
                            child: NeuField(
                              controller: _portions[i]._price,
                              label: '',
                              hint: '0',
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close_rounded, size: 18, color: AppTheme.muted),
                            onPressed: () => setState(() {
                              _portions[i].dispose();
                              _portions.removeAt(i);
                            }),
                          ),
                        ],
                      ),
                    ),
                  if (!_hasSizes)
                    NeuField(
                      controller: _price,
                      label: 'Price',
                      hint: '220',
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      required: true,
                    )
                  else
                    const Padding(
                      padding: EdgeInsets.only(bottom: AppTheme.s4),
                      child: Text(
                        'The dish is ordered by size — the price above is not charged.',
                        style: TextStyle(color: AppTheme.muted, fontSize: 12),
                      ),
                    ),
                  const SizedBox(height: AppTheme.s8),
                  NeuField(
                    controller: _sortOrder,
                    label: 'Order in section (optional)',
                    hint: '0',
                    keyboardType: TextInputType.number,
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s8),
            _Footer(
              submitting: submitting,
              onCancel: () => Navigator.of(context).pop(),
              onSubmit: _submit,
              editing: _editing,
            ),
          ],
        ),
      ),
    );
  }

  Widget _photoPicker() {
    final existing = widget.item?.image;
    ImageProvider? preview;
    if (_newPhoto != null) {
      preview = FileImage(File(_newPhoto!.path));
    } else if (!_removeImage && existing != null) {
      preview = NetworkImage('$baseUrl/menu-images/$existing');
    }

    return Wrap(
      spacing: AppTheme.s8,
      runSpacing: AppTheme.s8,
      children: [
        if (preview != null)
          PhotoThumb(
            imageProvider: preview,
            onRemove: () => setState(() {
              if (_newPhoto != null) {
                _newPhoto = null;
              } else {
                _removeImage = true;
              }
            }),
          )
        else
          AddPhotoTile(onTap: _pickPhoto),
      ],
    );
  }

  Future<void> _pickPhoto() async {
    final source = await showPhotoSourceSheet(
      context,
      title: 'Dish photo',
      subtitle: 'Take a photo or pick one from your gallery',
    );
    if (source == null) return;
    final picked = await ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 1600);
    if (picked != null) {
      setState(() {
        _newPhoto = picked;
        _removeImage = false;
      });
    }
  }

  Future<void> _submit() async {
    setState(() {
      _error = null;
      _submitAttempted = true;
    });
    if (_categoryId == null) return;
    if (_name.text.trim().isEmpty) return;

    final namedPortions = _portions.where((p) => p._label.text.trim().isNotEmpty).toList();
    for (final p in namedPortions) {
      final value = num.tryParse(p._price.text.trim());
      if (value == null || value < 0) {
        setState(() => _error = '"${p._label.text.trim()}" needs a price of 0 or more.');
        return;
      }
    }
    num price = 0;
    if (namedPortions.isNotEmpty) {
      price = namedPortions.map((p) => num.parse(p._price.text.trim())).reduce((a, b) => a < b ? a : b);
    } else {
      final value = num.tryParse(_price.text.trim());
      if (value == null || value < 0) {
        setState(() => _error = 'Price is required.');
        return;
      }
      price = value;
    }

    final formMap = <String, dynamic>{
      'categoryId': '$_categoryId',
      'name': _name.text.trim(),
      'description': _description.text.trim(),
      'price': '$price',
      'foodType': _foodType,
      'sortOrder': _sortOrder.text.trim().isEmpty ? '0' : _sortOrder.text.trim(),
    };
    if (_newPhoto != null) {
      formMap['image'] = dio.MultipartFile.fromFileSync(_newPhoto!.path, filename: _newPhoto!.name);
    } else if (_removeImage) {
      formMap['removeImage'] = 'true';
    }

    final portions = namedPortions
        .map((p) => {'label': p._label.text.trim(), 'price': num.parse(p._price.text.trim())})
        .toList();

    final vm = ref.read(menuViewModelProvider.notifier);
    final ok = await vm.saveItem(
      dio.FormData.fromMap(formMap),
      itemId: widget.item?.id,
      portions: portions,
    );
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(menuViewModelProvider).error ?? 'Could not save the item.');
    }
  }
}

/// The veg/non-veg pick, drawn as its own mark rather than a plain
/// [NeuButton] label — the same square-in-square guests see on every dish
/// card, so choosing it here previews exactly what the menu will show.
class _FoodTypeChoice extends StatelessWidget {
  final String label;
  final bool isVeg;
  final bool selected;
  final VoidCallback onTap;

  const _FoodTypeChoice({required this.label, required this.isVeg, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final markColor = isVeg ? AppTheme.vacant : AppTheme.danger;

    return GestureDetector(
      onTap: onTap,
      // A tinted fill and a colored border when selected — not just a
      // shadow difference, which read as "the same button twice" at a
      // glance. The checkmark is the same cue CategoryCard uses for its own
      // selected state, so a chosen Type reads the same way everywhere.
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
        decoration: BoxDecoration(
          color: selected ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.card,
          borderRadius: BorderRadius.circular(AppTheme.rMedium),
          border: Border.all(color: selected ? AppTheme.accent : AppTheme.border, width: selected ? 1.5 : 1),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 14,
              height: 14,
              decoration: BoxDecoration(border: Border.all(color: markColor, width: 1.5), borderRadius: BorderRadius.circular(3)),
              alignment: Alignment.center,
              child: Container(width: 7, height: 7, decoration: BoxDecoration(color: markColor, shape: BoxShape.circle)),
            ),
            const SizedBox(width: 8),
            Text(label, style: TextStyle(color: selected ? AppTheme.accent : AppTheme.text, fontWeight: FontWeight.w600, fontSize: 13)),
            if (selected) ...[
              const SizedBox(width: 6),
              const Icon(Icons.check_circle_rounded, color: AppTheme.accent, size: 16),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Footer ───────────────────────────────────────────────────────────────────

class _Footer extends StatelessWidget {
  final bool submitting;
  final bool editing;
  final VoidCallback onCancel;
  final VoidCallback onSubmit;

  const _Footer({required this.submitting, required this.editing, required this.onCancel, required this.onSubmit});

  @override
  Widget build(BuildContext context) {
    // Natural-sized buttons in a FittedBox, same as the Rooms form's own
    // Cancel/Add room pair — Expanded/flex forced Cancel into a share of the
    // width too narrow for its own label and ellipsized it ("Ca…"), where
    // this only shrinks the pair together, as a unit, if space ever runs out.
    return Align(
      alignment: Alignment.centerRight,
      child: FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerRight,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            NeuButton(
              onPressed: submitting ? null : onCancel,
              child: const Text('Cancel'),
            ),
            const SizedBox(width: AppTheme.s12),
            NeuButton(
              primary: true,
              onPressed: submitting ? null : onSubmit,
              child: submitting
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Text(editing ? 'Save changes' : 'Add dish'),
            ),
          ],
        ),
      ),
    );
  }
}
