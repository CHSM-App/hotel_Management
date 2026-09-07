import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/constant.dart';
import '../../domain/models/category.dart';
import '../../domain/models/room.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'room_form_pieces.dart';

/// Edit an existing room. Multipart under the hood — the same route takes
/// photos alongside the text fields, so even an edit with no new photo
/// submits as a form.
///
/// Adding a room is a separate, full-page screen (see add_room_page.dart) —
/// this sheet now only ever opens with a room to edit.
Future<void> showRoomFormSheet(
  BuildContext context, {
  required List<RoomCategory> categories,
  required RoomListing room,
}) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _RoomFormSheet(categories: categories, room: room),
  );
}

class _RoomFormSheet extends ConsumerStatefulWidget {
  final List<RoomCategory> categories;
  final RoomListing room;

  const _RoomFormSheet({required this.categories, required this.room});

  @override
  ConsumerState<_RoomFormSheet> createState() => _RoomFormSheetState();
}

class _RoomFormSheetState extends ConsumerState<_RoomFormSheet> {
  late final _roomNumber = TextEditingController(text: widget.room.roomNumber);
  late final _floor = TextEditingController(text: widget.room.floor ?? '');
  late final _maxOccupancy = TextEditingController(
    text: widget.room.maxOccupancy?.toString() ?? '',
  );
  late final _description = TextEditingController(text: widget.room.description ?? '');

  int? _categoryId;
  String? _bathroomType;
  late List<BedDraft> _beds;
  final List<XFile> _newPhotos = [];
  late List<RoomImage> _existingPhotos;

  String? _error;

  @override
  void initState() {
    super.initState();
    final room = widget.room;
    _categoryId = room.category.id;
    _bathroomType = room.bathroomType;
    _beds = room.beds.isNotEmpty
        ? room.beds.map((b) => BedDraft(size: b.size, count: b.count)).toList()
        : [BedDraft()];
    _existingPhotos = List.of(room.images);
  }

  @override
  void dispose() {
    _roomNumber.dispose();
    _floor.dispose();
    _maxOccupancy.dispose();
    _description.dispose();
    for (final bed in _beds) {
      bed.countController.dispose();
    }
    super.dispose();
  }

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
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: AppTheme.accent.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(AppTheme.rSmall),
                      ),
                      child: const Icon(
                        Icons.edit_outlined,
                        color: AppTheme.accent,
                        size: 18,
                      ),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    Expanded(
                      child: Text(
                        'Edit room · ${widget.room.roomNumber}',
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
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: AppTheme.s16),
                child: Divider(height: 1, color: AppTheme.border),
              ),
              const SizedBox(height: AppTheme.s4),
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
                    NeuField(
                      controller: _roomNumber,
                      label: 'Room number',
                      hint: '101',
                      keyboardType: TextInputType.text,
                    ),
                    const SizedBox(height: AppTheme.s16),

                    const FieldLabel('Category', Icons.category_outlined),
                    const SizedBox(height: AppTheme.s8),
                    CategoryPicker(
                      categories: widget.categories,
                      selectedId: _categoryId,
                      onSelect: (id) => setState(() => _categoryId = id),
                    ),
                    const SizedBox(height: AppTheme.s16),

                    NeuField(
                      controller: _floor,
                      label: 'Floor',
                      hint: '1',
                    ),
                    const SizedBox(height: AppTheme.s16),

                    const FieldLabel('Bathroom', Icons.bathtub_outlined),
                    const SizedBox(height: AppTheme.s8),
                    Wrap(
                      spacing: AppTheme.s8,
                      children: [
                        for (final type in bathroomTypes)
                          RoomChoiceChip(
                            label: bathroomLabel[type]!,
                            selected: _bathroomType == type,
                            onTap: () => setState(() => _bathroomType = type),
                          ),
                      ],
                    ),
                    const SizedBox(height: AppTheme.s16),

                    NeuCard(
                      shadow: AppTheme.subtle,
                      padding: const EdgeInsets.all(AppTheme.s12),
                      child: Column(
                        children: [
                          Row(
                            children: [
                              const Icon(Icons.bed_outlined, size: 16, color: AppTheme.accent),
                              const SizedBox(width: AppTheme.s8),
                              Expanded(
                                child: Text(
                                  'BEDS'.toUpperCase(),
                                  style: const TextStyle(
                                    color: AppTheme.muted,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 0.4,
                                  ),
                                ),
                              ),
                              TextButton.icon(
                                onPressed: () => setState(() => _beds.add(BedDraft())),
                                icon: const Icon(Icons.add_rounded, size: 16),
                                label: const Text('Add bed'),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppTheme.s8),
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
                                            for (final s in bedSizes)
                                              DropdownMenuItem(value: s, child: Text(bedSizeLabel[s]!)),
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

                    FieldLabel('Photos (up to $maxRoomImages)', Icons.photo_library_outlined),
                    const SizedBox(height: AppTheme.s8),
                    Wrap(
                      spacing: AppTheme.s8,
                      runSpacing: AppTheme.s8,
                      children: [
                        for (final img in _existingPhotos)
                          PhotoThumb(
                            imageProvider: NetworkImage('$baseUrl/room-images/${img.filename}'),
                            onRemove: () => _removeExistingPhoto(img),
                          ),
                        for (final file in _newPhotos)
                          PhotoThumb(
                            imageProvider: FileImage(File(file.path)),
                            onRemove: () => setState(() => _newPhotos.remove(file)),
                          ),
                        if (!_photosFull) AddPhotoTile(onTap: _pickPhotos),
                      ],
                    ),
                    const SizedBox(height: AppTheme.s24),
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
                  child: Text(submitting ? 'Saving…' : 'Save changes'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  bool get _photosFull => _existingPhotos.length + _newPhotos.length >= maxRoomImages;

  Future<void> _pickPhotos() async {
    final picked = await ImagePicker().pickMultiImage(imageQuality: 85);
    if (picked.isEmpty) return;
    final room = _existingPhotos.length + _newPhotos.length;
    final allowed = maxRoomImages - room;
    setState(() => _newPhotos.addAll(picked.take(allowed <= 0 ? 0 : allowed)));
  }

  Future<void> _removeExistingPhoto(RoomImage img) async {
    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = await vm.deleteRoomImage(widget.room.id, img.id);
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
    if (_roomNumber.text.trim().isEmpty) {
      setState(() => _error = 'Enter a room number.');
      return;
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
      'roomNumber': _roomNumber.text.trim(),
      'floor': _floor.text.trim(),
      'beds': jsonEncodeBeds(bedsJson),
      'bathroomType': _bathroomType,
      'maxOccupancy': '$occupancy',
      'description': _description.text.trim(),
    };
    for (final file in _newPhotos) {
      formMap.update(
        'images',
        (existing) => [...(existing as List), dio.MultipartFile.fromFileSync(file.path, filename: file.name)],
        ifAbsent: () => [dio.MultipartFile.fromFileSync(file.path, filename: file.name)],
      );
    }

    final form = dio.FormData.fromMap(formMap);

    final vm = ref.read(roomsViewModelProvider.notifier);
    final ok = await vm.saveRoom(form, roomId: widget.room.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(roomsViewModelProvider).error ?? 'Could not save the room.');
    }
  }
}
