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
import '../../widgets/photo_source_sheet.dart';
import '../theme.dart';
import 'room_form_pieces.dart';

/// Edit an existing room, as its own full-page screen rather than a sheet —
/// the same treatment as Add room (see add_room_page.dart), so both forms
/// read as one system instead of one being a full page and the other a
/// partial-height sheet squeezed under the status bar.
Future<void> showRoomFormSheet(
  BuildContext context, {
  required List<RoomCategory> categories,
  required RoomListing room,
}) {
  return Navigator.of(context).push(
    MaterialPageRoute(
      builder: (context) => EditRoomPage(categories: categories, room: room),
    ),
  );
}

class EditRoomPage extends ConsumerStatefulWidget {
  final List<RoomCategory> categories;
  final RoomListing room;

  const EditRoomPage({super.key, required this.categories, required this.room});

  @override
  ConsumerState<EditRoomPage> createState() => _EditRoomPageState();
}

class _EditRoomPageState extends ConsumerState<EditRoomPage> {
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

    return Scaffold(
      appBar: AppBar(title: Text('Edit room · ${widget.room.roomNumber}')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppTheme.s16,
            AppTheme.s8,
            AppTheme.s16,
            AppTheme.s32,
          ),
          children: [
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
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

                  const SectionLabel('Numbering', number: 1),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _roomNumber,
                    label: 'Room number',
                    hint: '101',
                    keyboardType: TextInputType.text,
                  ),
                  const SizedBox(height: AppTheme.s16),
                  NeuField(
                    controller: _floor,
                    label: 'Floor',
                    hint: '1',
                  ),

                  const SectionDivider(),
                  const SectionLabel('Category', number: 2),
                  const SizedBox(height: AppTheme.s12),
                  CategoryDropdown(
                    categories: widget.categories,
                    selectedId: _categoryId,
                    onSelect: (id) => setState(() => _categoryId = id),
                  ),

                  const SectionDivider(),
                  const SectionLabel('Bathroom', number: 3),
                  const SizedBox(height: AppTheme.s12),
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

                  const SectionDivider(),
                  SectionLabel(
                    'Beds',
                    number: 4,
                    trailing: _beds.length == 1 ? null : '${_beds.length}',
                  ),
                  const SizedBox(height: AppTheme.s12),
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
                                  dropdownColor: AppTheme.card,
                                  hint: const Text(
                                    'Choose bed size',
                                    style: TextStyle(color: AppTheme.muted, fontSize: 13.5),
                                  ),
                                  icon: const Icon(Icons.keyboard_arrow_down_rounded, color: AppTheme.muted),
                                  items: [
                                    for (final s in bedSizes)
                                      DropdownMenuItem(
                                        value: s,
                                        child: Text(
                                          bedSizeLabel[s]!,
                                          style: const TextStyle(
                                            color: AppTheme.heading,
                                            fontWeight: FontWeight.w600,
                                            fontSize: 13.5,
                                          ),
                                        ),
                                      ),
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
                  NeuButton(
                    expand: true,
                    onPressed: () => setState(() => _beds.add(BedDraft())),
                    padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                    child: const Text('+ Add another bed'),
                  ),
                  const SizedBox(height: AppTheme.s16),
                  NeuField(
                    controller: _maxOccupancy,
                    label: 'Max occupancy',
                    hint: '2',
                    keyboardType: TextInputType.number,
                  ),

                  const SectionDivider(),
                  const SectionLabel('Details', number: 5),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _description,
                    label: 'Description (optional)',
                    hint: 'Corner room, quiet side',
                    maxLength: 200,
                  ),

                  const SectionDivider(),
                  SectionLabel(
                    'Photos',
                    number: 6,
                    trailing: 'up to $maxRoomImages',
                  ),
                  const SizedBox(height: AppTheme.s12),
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
                ],
              ),
            ),

            const SizedBox(height: AppTheme.s24),
            Row(
              children: [
                Expanded(
                  child: NeuButton(
                    onPressed: submitting ? null : () => Navigator.of(context).pop(),
                    child: const Text('Close'),
                  ),
                ),
                const SizedBox(width: AppTheme.s12),
                Expanded(
                  flex: 2,
                  child: NeuButton(
                    primary: true,
                    expand: true,
                    onPressed: submitting ? null : _submit,
                    child: submitting
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Save changes'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  bool get _photosFull => _existingPhotos.length + _newPhotos.length >= maxRoomImages;

  Future<void> _pickPhotos() async {
    final room = _existingPhotos.length + _newPhotos.length;
    final allowed = maxRoomImages - room;
    if (allowed <= 0) return;
    final source = await showPhotoSourceSheet(
      context,
      title: 'Add photos',
      subtitle: 'Take a photo or pick some from your gallery',
    );
    if (source == null) return;
    if (source == ImageSource.camera) {
      final photo = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 85, maxWidth: 1600);
      if (photo != null) setState(() => _newPhotos.add(photo));
      return;
    }
    final picked = await ImagePicker().pickMultiImage(imageQuality: 85);
    if (picked.isEmpty) return;
    setState(() => _newPhotos.addAll(picked.take(allowed)));
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
