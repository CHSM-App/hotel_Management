import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../domain/models/category.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'room_form_pieces.dart';

/// Add one or a bulk range of rooms, as its own full-screen page — the same
/// shape as the website's own Add room panel: a header carrying the title,
/// the Single/Bulk switch and the close action together, numbered sections
/// in between, and a rate summary pinned above Cancel/Add room at the foot.
Future<void> showAddRoomPage(
  BuildContext context, {
  required List<RoomCategory> categories,
}) {
  return Navigator.of(context).push(
    MaterialPageRoute(builder: (context) => AddRoomPage(categories: categories)),
  );
}

class AddRoomPage extends ConsumerStatefulWidget {
  final List<RoomCategory> categories;

  const AddRoomPage({super.key, required this.categories});

  @override
  ConsumerState<AddRoomPage> createState() => _AddRoomPageState();
}

class _AddRoomPageState extends ConsumerState<AddRoomPage> {
  final _roomNumber = TextEditingController();
  final _rangeStart = TextEditingController();
  final _rangeEnd = TextEditingController();
  final _floor = TextEditingController();
  final _maxOccupancy = TextEditingController();
  final _description = TextEditingController();

  bool _bulkMode = false;
  int? _categoryId;
  String? _bathroomType;
  final List<BedDraft> _beds = [BedDraft()];
  final List<XFile> _newPhotos = [];

  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.categories.length == 1) _categoryId = widget.categories.first.id;
  }

  @override
  void dispose() {
    _roomNumber.dispose();
    _rangeStart.dispose();
    _rangeEnd.dispose();
    _floor.dispose();
    _maxOccupancy.dispose();
    _description.dispose();
    for (final bed in _beds) {
      bed.countController.dispose();
    }
    super.dispose();
  }

  RoomCategory? get _selectedCategory =>
      widget.categories.where((c) => c.id == _categoryId).firstOrNull;

  /// "1 room" or "10 rooms" — the count a valid range actually covers, the
  /// same figure the website's own rate summary reads off the two range
  /// boxes rather than off a separately-typed quantity.
  String get _roomCountLabel {
    if (!_bulkMode) return '1 room';
    final start = int.tryParse(_rangeStart.text.trim());
    final end = int.tryParse(_rangeEnd.text.trim());
    if (start == null || end == null || end < start) return 'Rooms';
    final count = end - start + 1;
    return '$count room${count == 1 ? '' : 's'}';
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(roomsViewModelProvider).submitting;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _Header(
              bulkMode: _bulkMode,
              onModeChanged: (bulk) => setState(() => _bulkMode = bulk),
              submitting: submitting,
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppTheme.s16,
                  AppTheme.s16,
                  AppTheme.s16,
                  AppTheme.s24,
                ),
                children: [
                  if (_error != null) ...[
                    Container(
                      padding: const EdgeInsets.all(AppTheme.s12),
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
                    const SizedBox(height: AppTheme.s16),
                  ],

                  NeuCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SectionLabel(_bulkMode ? 'Room range' : 'Room number', number: 1),
                        const SizedBox(height: AppTheme.s12),
                        if (!_bulkMode)
                          NeuField(
                            controller: _roomNumber,
                            label: 'Room number',
                            hint: '101',
                            required: true,
                            keyboardType: TextInputType.text,
                            onChanged: (_) => setState(() {}),
                          )
                        else
                          Row(
                            children: [
                              Expanded(
                                child: NeuField(
                                  controller: _rangeStart,
                                  label: 'From',
                                  hint: '101',
                                  required: true,
                                  keyboardType: TextInputType.number,
                                  onChanged: (_) => setState(() {}),
                                ),
                              ),
                              const SizedBox(width: AppTheme.s12),
                              Expanded(
                                child: NeuField(
                                  controller: _rangeEnd,
                                  label: 'To',
                                  hint: '110',
                                  required: true,
                                  keyboardType: TextInputType.number,
                                  onChanged: (_) => setState(() {}),
                                ),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTheme.s16),

                  NeuCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SectionLabel('Pricing', number: 2),
                        const SizedBox(height: AppTheme.s12),
                        const RequiredLabel('Category'),
                        const SizedBox(height: AppTheme.s8),
                        CategoryDropdown(
                          categories: widget.categories,
                          selectedId: _categoryId,
                          onSelect: (id) => setState(() => _categoryId = id),
                        ),
                        if (_selectedCategory != null) ...[
                          const SizedBox(height: AppTheme.s12),
                          Wrap(
                            spacing: AppTheme.s8,
                            runSpacing: AppTheme.s8,
                            children: [
                              _RateChip(
                                '${formatPrice(_selectedCategory!.basePrice)} /night',
                                accent: true,
                              ),
                              _RateChip(_selectedCategory!.name),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTheme.s16),

                  NeuCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SectionLabel('Room details', number: 3),
                        const SizedBox(height: AppTheme.s12),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: NeuField(
                                controller: _floor,
                                label: 'Floor',
                                hint: '1',
                                required: true,
                              ),
                            ),
                            const SizedBox(width: AppTheme.s12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const RequiredLabel('Bathroom'),
                                  const SizedBox(height: AppTheme.s8),
                                  OptionDropdown(
                                    values: bathroomTypes,
                                    labels: bathroomLabel,
                                    selected: _bathroomType,
                                    onSelect: (v) => setState(() => _bathroomType = v),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppTheme.s16),

                        const RequiredLabel('Beds'),
                        const SizedBox(height: AppTheme.s8),
                        for (var i = 0; i < _beds.length; i++)
                          Padding(
                            padding: const EdgeInsets.only(bottom: AppTheme.s8),
                            child: Row(
                              children: [
                                Expanded(
                                  flex: 2,
                                  child: OptionDropdown(
                                    values: bedSizes,
                                    labels: bedSizeLabel,
                                    selected: _beds[i].size.isEmpty ? null : _beds[i].size,
                                    onSelect: (v) => setState(() => _beds[i].size = v),
                                  ),
                                ),
                                const SizedBox(width: AppTheme.s8),
                                SizedBox(
                                  width: 64,
                                  child: NeuField(
                                    controller: _beds[i].countController,
                                    label: '',
                                    keyboardType: TextInputType.number,
                                    onChanged: (v) => _beds[i].count = int.tryParse(v) ?? 1,
                                  ),
                                ),
                                if (_beds.length > 1)
                                  IconButton(
                                    icon: const Icon(Icons.close_rounded, size: 18),
                                    color: AppTheme.muted,
                                    onPressed: () => setState(() {
                                      _beds[i].countController.dispose();
                                      _beds.removeAt(i);
                                    }),
                                  ),
                              ],
                            ),
                          ),
                        // A plain link, the same weight the website's own
                        // "+ Add another bed" carries — a bordered button here
                        // would outweigh a line this optional.
                        GestureDetector(
                          onTap: () => setState(() => _beds.add(BedDraft())),
                          child: const Padding(
                            padding: EdgeInsets.symmetric(vertical: AppTheme.s4),
                            child: Text(
                              '+ Add another bed',
                              style: TextStyle(
                                color: AppTheme.accent,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: AppTheme.s12),

                        NeuField(
                          controller: _maxOccupancy,
                          label: 'Max occupancy',
                          hint: '2',
                          required: true,
                          keyboardType: TextInputType.number,
                        ),
                        const SizedBox(height: AppTheme.s16),

                        NeuField(
                          controller: _description,
                          label: 'Description (optional)',
                          hint: 'Corner room, quiet side, good morning light',
                          maxLength: 200,
                        ),
                      ],
                    ),
                  ),

                  if (!_bulkMode) ...[
                    const SizedBox(height: AppTheme.s16),
                    NeuCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SectionLabel(
                            'Photos',
                            number: 4,
                            trailing: _newPhotos.isEmpty ? null : '${_newPhotos.length}',
                          ),
                          const SizedBox(height: AppTheme.s12),
                          Wrap(
                            spacing: AppTheme.s8,
                            runSpacing: AppTheme.s8,
                            children: [
                              for (final file in _newPhotos)
                                PhotoThumb(
                                  imageProvider: FileImage(File(file.path)),
                                  onRemove: () => setState(() => _newPhotos.remove(file)),
                                ),
                              if (_newPhotos.length < maxRoomImages)
                                AddPhotoTile(onTap: _pickPhotos),
                            ],
                          ),
                          const SizedBox(height: AppTheme.s8),
                          Text(
                            'Up to $maxRoomImages photos, JPG/PNG/WEBP, 5MB each.',
                            style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
            _Footer(
              roomCountLabel: _roomCountLabel,
              category: _selectedCategory,
              submitting: submitting,
              onCancel: () => Navigator.of(context).pop(),
              onSubmit: _submit,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickPhotos() async {
    final picked = await ImagePicker().pickMultiImage(imageQuality: 85);
    if (picked.isEmpty) return;
    final allowed = maxRoomImages - _newPhotos.length;
    setState(() => _newPhotos.addAll(picked.take(allowed <= 0 ? 0 : allowed)));
  }

  Future<void> _submit() async {
    setState(() => _error = null);

    if (_categoryId == null) {
      setState(() => _error = 'Choose a category.');
      return;
    }
    if (!_bulkMode) {
      if (_roomNumber.text.trim().isEmpty) {
        setState(() => _error = 'Enter a room number.');
        return;
      }
    } else {
      if (_rangeStart.text.trim().isEmpty || _rangeEnd.text.trim().isEmpty) {
        setState(() => _error = 'Enter the room range.');
        return;
      }
    }
    if (_floor.text.trim().isEmpty) {
      setState(() => _error = 'Enter the floor.');
      return;
    }
    if (_beds.isEmpty || _beds.any((b) => b.size.isEmpty)) {
      setState(() => _error = 'Choose a size for every bed.');
      return;
    }
    if (_beds.any((b) => b.count < 1)) {
      setState(() => _error = 'Each bed needs a count of 1 or more.');
      return;
    }
    if (_bathroomType == null) {
      setState(() => _error = 'Choose a bathroom type.');
      return;
    }
    final occupancy = int.tryParse(_maxOccupancy.text.trim());
    if (occupancy == null || occupancy <= 0) {
      setState(() => _error = 'Enter a max occupancy greater than 0.');
      return;
    }

    final bedsJson = _beds.map((b) => {'size': b.size, 'count': b.count}).toList();

    final formMap = <String, dynamic>{
      'categoryId': '$_categoryId',
      'floor': _floor.text.trim(),
      'beds': jsonEncodeBeds(bedsJson),
      'bathroomType': _bathroomType,
      'maxOccupancy': '$occupancy',
      'description': _description.text.trim(),
    };

    if (_bulkMode) {
      formMap['rangeStart'] = _rangeStart.text.trim();
      formMap['rangeEnd'] = _rangeEnd.text.trim();
    } else {
      formMap['roomNumber'] = _roomNumber.text.trim();
    }

    for (final file in _newPhotos) {
      formMap.update(
        'images',
        (existing) => [...(existing as List), dio.MultipartFile.fromFileSync(file.path, filename: file.name)],
        ifAbsent: () => [dio.MultipartFile.fromFileSync(file.path, filename: file.name)],
      );
    }

    final form = dio.FormData.fromMap(formMap);

    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = await vm.saveRoom(form);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(roomsViewModelProvider).error ?? 'Could not save the room.');
    }
  }
}

// ── Header ───────────────────────────────────────────────────────────────────

/// Title, the Single/Bulk switch and the close action on one row, and a
/// caption underneath that explains whichever mode is active — the same
/// shape the website's own modal head carries, kept in view while the body
/// scrolls beneath it.
class _Header extends StatelessWidget {
  final bool bulkMode;
  final ValueChanged<bool> onModeChanged;
  final bool submitting;

  const _Header({
    required this.bulkMode,
    required this.onModeChanged,
    required this.submitting,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s8, AppTheme.s12),
      decoration: const BoxDecoration(
        color: AppTheme.card,
        border: Border(bottom: BorderSide(color: AppTheme.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Add room',
                  style: TextStyle(
                    color: AppTheme.heading,
                    fontWeight: FontWeight.w700,
                    fontSize: 18,
                  ),
                ),
              ),
              ModeToggle(
                options: const {'single': 'Single', 'bulk': 'Bulk range'},
                selected: bulkMode ? 'bulk' : 'single',
                onSelect: (v) => onModeChanged(v == 'bulk'),
              ),
              IconButton(
                icon: const Icon(Icons.close_rounded),
                color: AppTheme.muted,
                onPressed: submitting ? null : () => Navigator.of(context).pop(),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            bulkMode
                ? 'Creates every room in the range at once, all sharing these '
                      'details. Photos are added per room afterwards.'
                : 'Adds one room to the chart. Everything but the description '
                      'and photos is needed before it can be booked.',
            style: const TextStyle(color: AppTheme.muted, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

// ── Footer ───────────────────────────────────────────────────────────────────

/// The rate this room (or range) will carry, pinned above Cancel/Add room —
/// the same "rate stays visible while the form is filled in" the booking
/// screen's own quote total does.
class _Footer extends StatelessWidget {
  final String roomCountLabel;
  final RoomCategory? category;
  final bool submitting;
  final VoidCallback onCancel;
  final VoidCallback onSubmit;

  const _Footer({
    required this.roomCountLabel,
    required this.category,
    required this.submitting,
    required this.onCancel,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s12),
      decoration: const BoxDecoration(
        color: AppTheme.bg,
        border: Border(top: BorderSide(color: AppTheme.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: category == null
                ? const Text(
                    'Pick a category to set the rate',
                    style: TextStyle(color: AppTheme.muted, fontSize: 12),
                    overflow: TextOverflow.ellipsis,
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '$roomCountLabel · ${category!.name}',
                        style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text.rich(
                        TextSpan(
                          text: formatPrice(category!.basePrice),
                          style: const TextStyle(
                            color: AppTheme.heading,
                            fontWeight: FontWeight.w700,
                            fontSize: 16,
                          ),
                          children: const [
                            TextSpan(
                              text: ' /night',
                              style: TextStyle(
                                color: AppTheme.muted,
                                fontWeight: FontWeight.w400,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
          ),
          const SizedBox(width: AppTheme.s12),
          NeuButton(
            onPressed: submitting ? null : onCancel,
            child: const Text('Cancel'),
          ),
          const SizedBox(width: AppTheme.s8),
          NeuButton(
            primary: true,
            onPressed: submitting ? null : onSubmit,
            child: submitting
                ? const SizedBox(
                    height: 16,
                    width: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Add room'),
          ),
        ],
      ),
    );
  }
}

class _RateChip extends StatelessWidget {
  final String label;
  final bool accent;

  const _RateChip(this.label, {this.accent = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: accent ? AppTheme.accent.withValues(alpha: 0.1) : AppTheme.bg,
        border: accent ? null : Border.all(color: AppTheme.border),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: accent ? AppTheme.accent : AppTheme.text,
          fontSize: 11.5,
          fontWeight: accent ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
    );
  }
}
