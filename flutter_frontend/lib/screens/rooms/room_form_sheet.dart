import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/constant.dart';
import '../../domain/models/category.dart';
import '../../domain/models/room.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

const _bedSizes = ['SINGLE', 'DOUBLE', 'QUEEN', 'KING'];
const _bedSizeLabel = {
  'SINGLE': 'Single',
  'DOUBLE': 'Double',
  'QUEEN': 'Queen',
  'KING': 'King',
};
const _bathroomTypes = ['ATTACHED', 'COMMON'];
const _bathroomLabel = {'ATTACHED': 'Attached bathroom', 'COMMON': 'Common bathroom'};
const _maxRoomImages = 6;

/// Add or edit a room. Multipart under the hood — the same route takes photos
/// alongside the text fields, so even an edit with no new photo submits as a
/// form.
Future<void> showRoomFormSheet(
  BuildContext context, {
  required List<RoomCategory> categories,
  RoomListing? room,
}) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _RoomFormSheet(categories: categories, room: room),
  );
}

class _BedDraft {
  String size;
  int count;
  final TextEditingController countController;
  _BedDraft({this.size = '', this.count = 1})
      : countController = TextEditingController(text: '$count');
}

class _RoomFormSheet extends ConsumerStatefulWidget {
  final List<RoomCategory> categories;
  final RoomListing? room;

  const _RoomFormSheet({required this.categories, this.room});

  @override
  ConsumerState<_RoomFormSheet> createState() => _RoomFormSheetState();
}

class _RoomFormSheetState extends ConsumerState<_RoomFormSheet> {
  late final _roomNumber = TextEditingController(text: widget.room?.roomNumber ?? '');
  final _rangeStart = TextEditingController();
  final _rangeEnd = TextEditingController();
  late final _floor = TextEditingController(text: widget.room?.floor ?? '');
  late final _maxOccupancy = TextEditingController(
    text: widget.room?.maxOccupancy?.toString() ?? '',
  );
  late final _description = TextEditingController(text: widget.room?.description ?? '');

  bool _bulkMode = false;
  int? _categoryId;
  String? _bathroomType;
  late List<_BedDraft> _beds;
  final List<XFile> _newPhotos = [];
  late List<RoomImage> _existingPhotos;

  bool get _editing => widget.room != null;
  String? _error;

  @override
  void initState() {
    super.initState();
    final room = widget.room;
    _categoryId = room?.category.id ?? (widget.categories.length == 1 ? widget.categories.first.id : null);
    _bathroomType = room?.bathroomType;
    _beds = room != null && room.beds.isNotEmpty
        ? room.beds.map((b) => _BedDraft(size: b.size, count: b.count)).toList()
        : [_BedDraft()];
    _existingPhotos = List.of(room?.images ?? const []);
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

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(roomsViewModelProvider).submitting;
    final mq = MediaQuery.of(context);

    return Padding(
      padding: EdgeInsets.only(bottom: mq.viewInsets.bottom),
      child: DraggableScrollableSheet(
        initialChildSize: 0.92,
        maxChildSize: 0.95,
        minChildSize: 0.5,
        expand: false,
        builder: (context, scrollController) => Container(
          decoration: const BoxDecoration(
            color: AppTheme.bg,
            borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.rLarge)),
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppTheme.s16,
                  AppTheme.s16,
                  AppTheme.s8,
                  AppTheme.s8,
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        _editing ? 'Edit room · ${widget.room!.roomNumber}' : 'Add room',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close_rounded),
                      onPressed: submitting ? null : () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.fromLTRB(
                    AppTheme.s16,
                    0,
                    AppTheme.s16,
                    AppTheme.s24,
                  ),
                  children: [
                    if (_error != null) ...[
                      NeuCard(
                        shadow: AppTheme.subtle,
                        child: Text(_error!, style: const TextStyle(color: AppTheme.danger)),
                      ),
                      const SizedBox(height: AppTheme.s16),
                    ],
                    if (!_editing) ...[
                      _ToggleGroup(
                        options: const {'single': 'Single', 'bulk': 'Bulk range'},
                        selected: _bulkMode ? 'bulk' : 'single',
                        onSelect: (v) => setState(() => _bulkMode = v == 'bulk'),
                      ),
                      const SizedBox(height: AppTheme.s16),
                    ],
                    if (_editing || !_bulkMode)
                      NeuField(
                        controller: _roomNumber,
                        label: 'Room number',
                        hint: '101',
                        keyboardType: TextInputType.text,
                      )
                    else
                      Row(
                        children: [
                          Expanded(
                            child: NeuField(
                              controller: _rangeStart,
                              label: 'From',
                              hint: '101',
                              keyboardType: TextInputType.number,
                            ),
                          ),
                          const SizedBox(width: AppTheme.s12),
                          Expanded(
                            child: NeuField(
                              controller: _rangeEnd,
                              label: 'To',
                              hint: '110',
                              keyboardType: TextInputType.number,
                            ),
                          ),
                        ],
                      ),
                    const SizedBox(height: AppTheme.s16),

                    Text('Category', style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: AppTheme.s8),
                    _CategoryPicker(
                      categories: widget.categories,
                      selectedId: _categoryId,
                      onSelect: (id) => setState(() => _categoryId = id),
                    ),
                    if (_selectedCategory != null) ...[
                      const SizedBox(height: AppTheme.s8),
                      Text(
                        '${formatPrice(_selectedCategory!.basePrice)} /night',
                        style: const TextStyle(
                          color: AppTheme.accent,
                          fontWeight: FontWeight.w500,
                          fontSize: 13,
                        ),
                      ),
                    ],
                    const SizedBox(height: AppTheme.s16),

                    NeuField(
                      controller: _floor,
                      label: 'Floor',
                      hint: '1',
                    ),
                    const SizedBox(height: AppTheme.s16),

                    Text('Bathroom', style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: AppTheme.s8),
                    Wrap(
                      spacing: AppTheme.s8,
                      children: [
                        for (final type in _bathroomTypes)
                          _ChoiceChip(
                            label: _bathroomLabel[type]!,
                            selected: _bathroomType == type,
                            onTap: () => setState(() => _bathroomType = type),
                          ),
                      ],
                    ),
                    const SizedBox(height: AppTheme.s16),

                    Row(
                      children: [
                        Expanded(
                          child: Text('Beds', style: Theme.of(context).textTheme.bodySmall),
                        ),
                        TextButton.icon(
                          onPressed: () => setState(() => _beds.add(_BedDraft())),
                          icon: const Icon(Icons.add_rounded, size: 16),
                          label: const Text('Add bed'),
                        ),
                      ],
                    ),
                    for (var i = 0; i < _beds.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppTheme.s8),
                        child: Row(
                          children: [
                            Expanded(
                              flex: 2,
                              child: NeuPressed(
                                padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                                child: DropdownButtonHideUnderline(
                                  child: DropdownButton<String>(
                                    isExpanded: true,
                                    value: _beds[i].size.isEmpty ? null : _beds[i].size,
                                    hint: const Text('Size', style: TextStyle(color: AppTheme.muted)),
                                    items: [
                                      for (final s in _bedSizes)
                                        DropdownMenuItem(value: s, child: Text(_bedSizeLabel[s]!)),
                                    ],
                                    onChanged: (v) => setState(() => _beds[i].size = v ?? ''),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: AppTheme.s8),
                            SizedBox(
                              width: 72,
                              child: NeuField(
                                controller: _beds[i].countController,
                                label: '',
                                keyboardType: TextInputType.number,
                                onChanged: (v) =>
                                    _beds[i].count = int.tryParse(v) ?? 1,
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
                    const SizedBox(height: AppTheme.s8),

                    NeuField(
                      controller: _maxOccupancy,
                      label: 'Max occupancy',
                      hint: '2',
                      keyboardType: TextInputType.number,
                    ),
                    const SizedBox(height: AppTheme.s16),

                    NeuField(
                      controller: _description,
                      label: 'Description (optional)',
                      hint: 'Corner room, quiet side',
                      maxLength: 200,
                    ),
                    const SizedBox(height: AppTheme.s16),

                    if (_editing || !_bulkMode) ...[
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Photos (up to $_maxRoomImages)',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                          TextButton.icon(
                            onPressed: _photosFull ? null : _pickPhotos,
                            icon: const Icon(Icons.add_a_photo_outlined, size: 16),
                            label: const Text('Add'),
                          ),
                        ],
                      ),
                      if (_existingPhotos.isNotEmpty || _newPhotos.isNotEmpty)
                        Wrap(
                          spacing: AppTheme.s8,
                          runSpacing: AppTheme.s8,
                          children: [
                            for (final img in _existingPhotos)
                              _PhotoThumb(
                                imageProvider: NetworkImage('$baseUrl/room-images/${img.filename}'),
                                onRemove: () => _removeExistingPhoto(img),
                              ),
                            for (final file in _newPhotos)
                              _PhotoThumb(
                                imageProvider: FileImage(File(file.path)),
                                onRemove: () => setState(() => _newPhotos.remove(file)),
                              ),
                          ],
                        ),
                      const SizedBox(height: AppTheme.s24),
                    ],
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppTheme.s16,
                  AppTheme.s8,
                  AppTheme.s16,
                  AppTheme.s16,
                ),
                child: NeuButton(
                  primary: true,
                  expand: true,
                  onPressed: submitting ? null : _submit,
                  child: Text(
                    submitting
                        ? (_editing ? 'Saving…' : 'Adding…')
                        : (_editing ? 'Save changes' : 'Add room'),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  bool get _photosFull => _existingPhotos.length + _newPhotos.length >= _maxRoomImages;

  Future<void> _pickPhotos() async {
    final picked = await ImagePicker().pickMultiImage(imageQuality: 85);
    if (picked.isEmpty) return;
    final room = _existingPhotos.length + _newPhotos.length;
    final allowed = _maxRoomImages - room;
    setState(() => _newPhotos.addAll(picked.take(allowed <= 0 ? 0 : allowed)));
  }

  Future<void> _removeExistingPhoto(RoomImage img) async {
    if (widget.room == null) return;
    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = await vm.deleteRoomImage(widget.room!.id, img.id);
    if (!mounted) return;
    if (ok) {
      setState(() => _existingPhotos.removeWhere((i) => i.id == img.id));
    } else {
      setState(() => _error = ref.read(roomsViewModelProvider).error ?? 'Could not delete this photo.');
    }
  }

  Future<void> _submit() async {
    setState(() => _error = null);

    if (_categoryId == null) {
      setState(() => _error = 'Choose a category.');
      return;
    }
    if (_editing || !_bulkMode) {
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

    final bedsJson = _beds
        .map((b) => {'size': b.size, 'count': b.count})
        .toList();

    final map = <String, dynamic>{
      'categoryId': '$_categoryId',
      'floor': _floor.text.trim(),
      'beds': _jsonEncodeBeds(bedsJson),
      'bathroomType': _bathroomType,
      'maxOccupancy': '$occupancy',
      'description': _description.text.trim(),
    };

    if (_editing) {
      map['roomNumber'] = _roomNumber.text.trim();
    } else if (_bulkMode) {
      map['rangeStart'] = _rangeStart.text.trim();
      map['rangeEnd'] = _rangeEnd.text.trim();
    } else {
      map['roomNumber'] = _roomNumber.text.trim();
    }

    final formMap = <String, dynamic>{...map};
    for (final file in _newPhotos) {
      formMap.update(
        'images',
        (existing) => [...(existing as List), dio.MultipartFile.fromFileSync(file.path, filename: file.name)],
        ifAbsent: () => [dio.MultipartFile.fromFileSync(file.path, filename: file.name)],
      );
    }

    final form = dio.FormData.fromMap(formMap);

    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = await vm.saveRoom(form, roomId: widget.room?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(roomsViewModelProvider).error ?? 'Could not save the room.');
    }
  }

  String _jsonEncodeBeds(List<Map<String, dynamic>> beds) {
    final parts = beds.map((b) => '{"size":"${b['size']}","count":${b['count']}}');
    return '[${parts.join(',')}]';
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}

// ── Small pieces ─────────────────────────────────────────────────────────────

class _ToggleGroup extends StatelessWidget {
  final Map<String, String> options;
  final String selected;
  final ValueChanged<String> onSelect;

  const _ToggleGroup({required this.options, required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final entry in options.entries) ...[
          Expanded(
            child: GestureDetector(
              onTap: () => onSelect(entry.key),
              child: entry.key == selected
                  ? NeuPressed(
                      padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
                      child: Center(
                        child: Text(
                          entry.value,
                          style: const TextStyle(color: AppTheme.accent, fontSize: 13, fontWeight: FontWeight.w500),
                        ),
                      ),
                    )
                  : NeuCard(
                      shadow: AppTheme.subtle,
                      padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
                      child: Center(
                        child: Text(entry.value, style: const TextStyle(color: AppTheme.text, fontSize: 13)),
                      ),
                    ),
            ),
          ),
          if (entry.key != options.keys.last) const SizedBox(width: AppTheme.s8),
        ],
      ],
    );
  }
}

class _CategoryPicker extends StatelessWidget {
  final List<RoomCategory> categories;
  final int? selectedId;
  final ValueChanged<int> onSelect;

  const _CategoryPicker({required this.categories, required this.selectedId, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppTheme.s8,
      runSpacing: AppTheme.s8,
      children: [
        for (final c in categories.where((c) => c.isActive || c.id == selectedId))
          _ChoiceChip(
            label: c.name,
            selected: selectedId == c.id,
            onTap: () => onSelect(c.id),
          ),
      ],
    );
  }
}

class _ChoiceChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _ChoiceChip({required this.label, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final text = Text(
      label,
      style: TextStyle(
        color: selected ? AppTheme.accent : AppTheme.text,
        fontWeight: selected ? FontWeight.w500 : FontWeight.w400,
        fontSize: 13,
      ),
    );
    return GestureDetector(
      onTap: onTap,
      child: selected
          ? NeuPressed(
              radius: 999,
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s8),
              child: text,
            )
          : NeuCard(
              radius: 999,
              shadow: AppTheme.subtle,
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s8),
              child: text,
            ),
    );
  }
}

class _PhotoThumb extends StatelessWidget {
  final ImageProvider imageProvider;
  final VoidCallback onRemove;

  const _PhotoThumb({required this.imageProvider, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(AppTheme.rSmall),
          child: Image(image: imageProvider, width: 72, height: 72, fit: BoxFit.cover),
        ),
        Positioned(
          top: -6,
          right: -6,
          child: GestureDetector(
            onTap: onRemove,
            child: Container(
              padding: const EdgeInsets.all(2),
              decoration: const BoxDecoration(color: AppTheme.danger, shape: BoxShape.circle),
              child: const Icon(Icons.close_rounded, size: 14, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}
