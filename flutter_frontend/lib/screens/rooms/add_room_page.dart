import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../domain/models/category.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'room_form_pieces.dart';

/// Add one or a bulk range of rooms, as its own full-screen page rather than
/// a sheet — the desk sets up a property's whole inventory in this flow, in
/// one sitting, and that deserves the same screen real estate as any other
/// full page rather than a partial-height sheet squeezed under the status bar.
///
/// Framed exactly like Take a Booking: one scrolling page, one card holding
/// every section, a section label plus a hairline divider between them,
/// rather than a card per section — the two forms the desk fills in most
/// read as one system now.
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

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(roomsViewModelProvider).submitting;

    return Scaffold(
      appBar: AppBar(title: const Text('Add room')),
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

                  const SectionLabel('Numbering', icon: Icons.tag_rounded),
                  const SizedBox(height: AppTheme.s12),
                  ToggleGroup(
                    options: const {'single': 'Single room', 'bulk': 'Bulk range'},
                    selected: _bulkMode ? 'bulk' : 'single',
                    onSelect: (v) => setState(() => _bulkMode = v == 'bulk'),
                  ),
                  const SizedBox(height: AppTheme.s16),
                  if (!_bulkMode)
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
                  NeuField(
                    controller: _floor,
                    label: 'Floor',
                    hint: '1',
                  ),

                  const SectionDivider(),
                  const SectionLabel('Category', icon: Icons.category_outlined),
                  const SizedBox(height: AppTheme.s12),
                  CategoryDropdown(
                    categories: widget.categories,
                    selectedId: _categoryId,
                    onSelect: (id) => setState(() => _categoryId = id),
                  ),

                  const SectionDivider(),
                  const SectionLabel('Bathroom', icon: Icons.bathtub_outlined),
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
                    icon: Icons.bed_outlined,
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
                  const SectionLabel('Details', icon: Icons.notes_rounded),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _description,
                    label: 'Description (optional)',
                    hint: 'Corner room, quiet side',
                    maxLength: 200,
                  ),

                  if (!_bulkMode) ...[
                    const SectionDivider(),
                    SectionLabel(
                      'Photos',
                      icon: Icons.photo_library_outlined,
                      trailing: 'up to $maxRoomImages',
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
                  ],
                ],
              ),
            ),

            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: submitting ? null : _submit,
              child: submitting
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Add room'),
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
