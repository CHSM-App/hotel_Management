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
import '../../widgets/photo_source_sheet.dart';
import '../theme.dart';
import 'add_room_page.dart' show RoomFormFooter, RateChip;
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
  final _scrollController = ScrollController();

  // One key per required section, in the order the form asks them — a failed
  // save jumps straight to the first thing wrong (same as Add room).
  final _roomNumberKey = GlobalKey();
  final _floorKey = GlobalKey();
  final _categoryKey = GlobalKey();
  final _bathroomKey = GlobalKey();
  final _dormitoryKey = GlobalKey();
  final _bedsKey = GlobalKey();
  final _occupancyKey = GlobalKey();

  late final _roomNumber = TextEditingController(text: widget.room.roomNumber);
  late final _floor = TextEditingController(text: widget.room.floor ?? '');
  late final _maxOccupancy = TextEditingController(
    text: widget.room.maxOccupancy?.toString() ?? '',
  );
  late final _description = TextEditingController(text: widget.room.description ?? '');
  late final _dormitoryPrice = TextEditingController(
    text: widget.room.dormitoryPrice != null ? '${widget.room.dormitoryPrice}' : '',
  );

  int? _categoryId;
  String? _bathroomType;
  late List<BedDraft> _beds;
  final List<XFile> _newPhotos = [];
  late List<RoomImage> _existingPhotos;

  late bool _isDormitory;
  String? _dormitoryGender;
  String? _dormitoryIsAc;
  late int _dormitoryBedCount;

  String? _error;

  /// The backend's name for the field [_error] is about (e.g. "roomNumber"
  /// for "Room number already in use.") — lets this form scroll to and
  /// highlight the exact field a conflict was about.
  String? _backendErrorField;

  /// Nothing turns red until Save has been pressed at least once.
  bool _submitAttempted = false;

  String? get _roomNumberError {
    if (_backendErrorField == 'roomNumber') return _error;
    if (!_submitAttempted) return null;
    return _roomNumber.text.trim().isEmpty ? 'Enter a room number.' : null;
  }

  String? get _floorError {
    if (!_submitAttempted) return null;
    return _floor.text.trim().isEmpty ? 'Enter the floor.' : null;
  }

  String? get _categoryError {
    if (!_submitAttempted) return null;
    return _categoryId == null ? 'Choose a category.' : null;
  }

  String? get _bathroomError {
    if (!_submitAttempted) return null;
    return _bathroomType == null ? 'Choose a bathroom type.' : null;
  }

  String? get _bedsError {
    if (!_submitAttempted || _isDormitory) return null;
    if (_beds.isEmpty || _beds.any((b) => b.size.isEmpty)) {
      return 'Choose a size for every bed.';
    }
    if (_beds.any((b) => b.count < 1)) return 'Each bed needs a count of 1 or more.';
    return null;
  }

  String? get _occupancyError {
    if (!_submitAttempted || _isDormitory) return null;
    final occupancy = int.tryParse(_maxOccupancy.text.trim());
    return (occupancy == null || occupancy <= 0)
        ? 'Enter a max occupancy greater than 0.'
        : null;
  }

  String? get _dormitoryError {
    if (!_submitAttempted || !_isDormitory) return null;
    if (_dormitoryGender == null) return 'Choose who this dormitory is for.';
    final price = num.tryParse(_dormitoryPrice.text.trim());
    if (price == null || price <= 0) return 'Enter a price per night for this dormitory.';
    if (_dormitoryIsAc == null) return 'Choose AC or Non-AC.';
    return null;
  }

  void _scrollToError(GlobalKey key) {
    final context = key.currentContext;
    if (context == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Scrollable.ensureVisible(
        context,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
        alignment: 0.1,
      );
    });
  }

  RoomCategory? get _selectedCategory =>
      widget.categories.where((c) => c.id == _categoryId).firstOrNull;

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
    _isDormitory = room.isDormitory;
    _dormitoryGender = room.dormitoryGender;
    _dormitoryIsAc = room.dormitoryIsAc;
    _dormitoryBedCount = room.dormitoryBeds.isNotEmpty ? room.dormitoryBeds.length : 1;
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _roomNumber.dispose();
    _floor.dispose();
    _maxOccupancy.dispose();
    _description.dispose();
    _dormitoryPrice.dispose();
    for (final bed in _beds) {
      bed.countController.dispose();
    }
    super.dispose();
  }

  Widget _errorText(String text) => Padding(
        padding: const EdgeInsets.only(top: AppTheme.s4),
        child: Text(text, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
      );

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(roomsViewModelProvider).submitting;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Edit room · ${widget.room.roomNumber}',
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
              controller: _scrollController,
              padding: const EdgeInsets.fromLTRB(
                AppTheme.s12,
                AppTheme.s12,
                AppTheme.s12,
                AppTheme.s16,
              ),
              children: [
                if (_error != null && _backendErrorField != 'roomNumber') ...[
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
                  const SizedBox(height: AppTheme.s12),
                ],
                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.elevated,
                  padding: const EdgeInsets.all(AppTheme.s16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SectionLabel('Numbering', number: 1, icon: Icons.tag_rounded),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        key: _roomNumberKey,
                        controller: _roomNumber,
                        label: 'Room number',
                        hint: '101',
                        required: true,
                        errorText: _roomNumberError,
                        keyboardType: TextInputType.text,
                        forceUppercase: true,
                        onChanged: (_) => setState(() {}),
                        dense: true,
                      ),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        key: _floorKey,
                        controller: _floor,
                        label: 'Floor',
                        hint: '1',
                        required: true,
                        errorText: _floorError,
                        onChanged: (_) => setState(() {}),
                        dense: true,
                      ),

                      const SectionDivider(),
                      const SectionLabel('Pricing', number: 2, icon: Icons.payments_rounded),
                      const SizedBox(height: AppTheme.s12),
                      const RequiredLabel('Category'),
                      const SizedBox(height: AppTheme.s8),
                      KeyedSubtree(
                        key: _categoryKey,
                        child: CategoryDropdown(
                          categories: widget.categories,
                          selectedId: _categoryId,
                          hasError: _categoryError != null,
                          onSelect: (id) => setState(() => _categoryId = id),
                        ),
                      ),
                      if (_categoryError != null) _errorText(_categoryError!),
                      if (_selectedCategory != null) ...[
                        const SizedBox(height: AppTheme.s12),
                        Wrap(
                          spacing: AppTheme.s8,
                          runSpacing: AppTheme.s8,
                          children: [
                            RateChip('${formatPrice(_selectedCategory!.basePrice)} /night', accent: true),
                            RateChip(_selectedCategory!.name),
                          ],
                        ),
                      ],

                      const SectionDivider(),
                      const SectionLabel('Room details', number: 3, icon: Icons.king_bed_rounded),
                      const SizedBox(height: AppTheme.s12),
                      const RequiredLabel('Bathroom'),
                      const SizedBox(height: AppTheme.s8),
                      KeyedSubtree(
                        key: _bathroomKey,
                        child: OptionDropdown(
                          values: bathroomTypes,
                          labels: bathroomLabel,
                          selected: _bathroomType,
                          hasError: _bathroomError != null,
                          onSelect: (v) => setState(() => _bathroomType = v),
                        ),
                      ),
                      if (_bathroomError != null) _errorText(_bathroomError!),
                      const SizedBox(height: AppTheme.s12),

                      KeyedSubtree(
                        key: _dormitoryKey,
                        child: GestureDetector(
                          onTap: () => setState(() => _isDormitory = !_isDormitory),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 150),
                            padding: const EdgeInsets.symmetric(
                              horizontal: AppTheme.s12,
                              vertical: AppTheme.s8,
                            ),
                            decoration: BoxDecoration(
                              color: _isDormitory ? AppTheme.accent.withValues(alpha: 0.07) : AppTheme.bg,
                              borderRadius: BorderRadius.circular(AppTheme.rMedium),
                              border: Border.all(
                                color: _isDormitory
                                    ? AppTheme.accent.withValues(alpha: 0.35)
                                    : AppTheme.border,
                              ),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 30,
                                  height: 30,
                                  alignment: Alignment.center,
                                  decoration: BoxDecoration(
                                    color: _isDormitory
                                        ? AppTheme.accent.withValues(alpha: 0.12)
                                        : AppTheme.card,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    Icons.bed_rounded,
                                    size: 16,
                                    color: _isDormitory ? AppTheme.accent : AppTheme.muted,
                                  ),
                                ),
                                const SizedBox(width: AppTheme.s12),
                                Expanded(
                                  child: Text(
                                    'This is a dormitory (sold bed-by-bed)',
                                    style: Theme.of(context).textTheme.bodyMedium,
                                  ),
                                ),
                                Switch(
                                  value: _isDormitory,
                                  onChanged: (v) => setState(() => _isDormitory = v),
                                  activeThumbColor: AppTheme.accent,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      if (_isDormitory) ...[
                        const SizedBox(height: AppTheme.s12),
                        const RequiredLabel('Who is this dormitory for'),
                        const SizedBox(height: AppTheme.s8),
                        OptionDropdown(
                          values: dormitoryGenders,
                          labels: dormitoryGenderLabel,
                          selected: _dormitoryGender,
                          hasError: _dormitoryError != null && _dormitoryGender == null,
                          onSelect: (v) => setState(() => _dormitoryGender = v),
                        ),
                        const SizedBox(height: AppTheme.s12),
                        NeuField(
                          controller: _dormitoryPrice,
                          label: 'Price per bed, per night',
                          hint: '500',
                          required: true,
                          keyboardType: TextInputType.number,
                          onChanged: (_) => setState(() {}),
                          dense: true,
                        ),
                        const SizedBox(height: AppTheme.s12),
                        const RequiredLabel('AC'),
                        const SizedBox(height: AppTheme.s8),
                        OptionDropdown(
                          values: dormitoryAcOptions,
                          labels: dormitoryAcLabel,
                          selected: _dormitoryIsAc,
                          hasError: _dormitoryError != null && _dormitoryIsAc == null,
                          onSelect: (v) => setState(() => _dormitoryIsAc = v),
                        ),
                        const SizedBox(height: AppTheme.s12),
                        DormitoryBedCountField(
                          beds: widget.room.dormitoryBeds,
                          count: _dormitoryBedCount,
                          onChanged: (v) => setState(() => _dormitoryBedCount = v),
                        ),
                        if (_dormitoryError != null) _errorText(_dormitoryError!),
                      ] else ...[
                        const SizedBox(height: AppTheme.s12),
                        const RequiredLabel('Beds'),
                        const SizedBox(height: AppTheme.s8),
                        KeyedSubtree(
                          key: _bedsKey,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              for (var i = 0; i < _beds.length; i++)
                                Container(
                                  margin: const EdgeInsets.only(bottom: AppTheme.s8),
                                  padding: const EdgeInsets.all(AppTheme.s8),
                                  decoration: BoxDecoration(
                                    color: AppTheme.bg,
                                    borderRadius: BorderRadius.circular(AppTheme.rMedium),
                                    border: Border.all(color: AppTheme.border),
                                  ),
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
                                          dense: true,
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
                              GestureDetector(
                                onTap: () => setState(() => _beds.add(BedDraft())),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: AppTheme.s12,
                                    vertical: AppTheme.s8,
                                  ),
                                  decoration: BoxDecoration(
                                    color: AppTheme.accent.withValues(alpha: 0.07),
                                    borderRadius: BorderRadius.circular(999),
                                    border: Border.all(color: AppTheme.accent.withValues(alpha: 0.3)),
                                  ),
                                  child: const Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.add_rounded, color: AppTheme.accent, size: 16),
                                      SizedBox(width: 4),
                                      Text(
                                        'Add another bed',
                                        style: TextStyle(
                                          color: AppTheme.accent,
                                          fontSize: 12.5,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              if (_bedsError != null) _errorText(_bedsError!),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppTheme.s12),
                        NeuField(
                          key: _occupancyKey,
                          controller: _maxOccupancy,
                          label: 'Max occupancy',
                          hint: '2',
                          required: true,
                          errorText: _occupancyError,
                          keyboardType: TextInputType.number,
                          onChanged: (_) => setState(() {}),
                          dense: true,
                        ),
                      ],
                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        controller: _description,
                        label: 'Description (optional)',
                        hint: 'Corner room, quiet side, good morning light',
                        maxLength: 200,
                        dense: true,
                      ),

                      const SectionDivider(),
                      SectionLabel(
                        'Photos',
                        number: 4,
                        icon: Icons.photo_camera_rounded,
                        trailing: '${_existingPhotos.length + _newPhotos.length}',
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
                      const SizedBox(height: AppTheme.s8),
                      Text(
                        'Up to $maxRoomImages photos, JPG/PNG/WEBP, 5MB each.',
                        style: const TextStyle(color: AppTheme.muted, fontSize: 11),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s16),
                RoomFormFooter(
                  submitLabel: 'Save changes',
                  submitIcon: Icons.check_rounded,
                  cancelLabel: 'Close',
                  roomCountLabel: 'Room ${widget.room.roomNumber}',
                  category: _selectedCategory,
                  submitting: submitting,
                  onCancel: () => Navigator.of(context).pop(),
                  onSubmit: _submit,
                ),
              ],
            ),
          ),
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
    setState(() {
      _error = null;
      _backendErrorField = null;
      _submitAttempted = true;
    });

    // Checked top to bottom, so the scroll lands on the first thing wrong.
    final checks = <(String?, GlobalKey)>[
      (_roomNumberError, _roomNumberKey),
      (_floorError, _floorKey),
      (_categoryError, _categoryKey),
      (_bathroomError, _bathroomKey),
      (_dormitoryError, _dormitoryKey),
      (_bedsError, _bedsKey),
      (_occupancyError, _occupancyKey),
    ];
    for (final (error, key) in checks) {
      if (error != null) {
        _scrollToError(key);
        return;
      }
    }

    final formMap = <String, dynamic>{
      'categoryId': '$_categoryId',
      'roomNumber': _roomNumber.text.trim(),
      'floor': _floor.text.trim(),
      'bathroomType': _bathroomType,
      'description': _description.text.trim(),
      'isDormitory': '$_isDormitory',
    };

    if (_isDormitory) {
      formMap['dormitoryGender'] = _dormitoryGender;
      formMap['dormitoryPrice'] = num.parse(_dormitoryPrice.text.trim()).toString();
      formMap['dormitoryIsAc'] = _dormitoryIsAc;
    } else {
      final occupancy = int.parse(_maxOccupancy.text.trim());
      final bedsJson = _beds.map((b) => {'size': b.size, 'count': b.count}).toList();
      formMap['beds'] = jsonEncodeBeds(bedsJson);
      formMap['maxOccupancy'] = '$occupancy';
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
    final result = await vm.saveRoom(form, roomId: widget.room.id);
    if (!mounted) return;
    if (!result.ok) {
      final state = ref.read(roomsViewModelProvider);
      setState(() {
        _error = state.error ?? 'Could not save the room.';
        _backendErrorField = state.errorField;
      });
      if (state.errorField == 'roomNumber') {
        _scrollToError(_roomNumberKey);
      }
      return;
    }

    if (_isDormitory && _dormitoryBedCount != widget.room.dormitoryBeds.length) {
      final bedsOk = await vm.setBedCount(widget.room.id, _dormitoryBedCount);
      if (!mounted) return;
      if (!bedsOk) {
        setState(() => _error = ref.read(roomsViewModelProvider).error ?? 'Room saved, but its bed count didn\'t.');
        return;
      }
    }

    Navigator.pop(context);
  }
}
