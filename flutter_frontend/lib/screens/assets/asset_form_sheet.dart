import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../domain/models/asset.dart';
import '../../domain/models/room.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../../widgets/photo_source_sheet.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

const _kSectionHeadingStyle = TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15);
const _kFieldLabelStyle = TextStyle(color: AppTheme.muted, fontSize: 12);
const _kFieldHintStyle = TextStyle(color: AppTheme.muted, fontSize: 11.5);

/// Offered as suggestions, not a fixed list — mirrors SUGGESTED_CATEGORIES
/// in AssetsPanel.jsx. A hotel-specific category is still just a typed name.
const _kSuggestedCategories = [
  'Air Conditioner',
  'Lift / Elevator',
  'Bed',
  'Television',
  'Geyser / Water Heater',
  'Generator',
  'Furniture',
  'Kitchen Equipment',
  'Plumbing',
  'Electrical',
  'Fire Safety',
  'CCTV / Security',
  'Laundry Equipment',
  'Housekeeping Equipment',
];

/// Register or edit an asset. Mirrors the register form in AssetsPanel.jsx,
/// including its Single/Bulk toggle — bulk mode files one purchase (one
/// category, one vendor, one bill) as several units — and the same field
/// sequence: Category, then "Purchase details", then "Installation details".
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
  int? roomId;

  void dispose() {
    name.dispose();
    serialNumber.dispose();
    floor.dispose();
    department.dispose();
  }
}

class _AssetFormScreenState extends ConsumerState<AssetFormScreen> {
  bool get _isEdit => widget.asset != null;

  bool _bulk = false;

  int? _vendorId;
  int? _roomId;
  late final _categoryName = TextEditingController(text: widget.asset?.categoryName ?? '');
  late final _name = TextEditingController(text: widget.asset?.name ?? '');
  late final _brand = TextEditingController(text: widget.asset?.brand ?? '');
  late final _model = TextEditingController(text: widget.asset?.model ?? '');
  late final _serialNumber = TextEditingController(text: widget.asset?.serialNumber ?? '');
  late final _purchaseDate = TextEditingController(text: widget.asset?.purchaseDate ?? '');
  late final _purchaseCost = TextEditingController(text: widget.asset?.purchaseCost?.toString() ?? '');
  late final _floor = TextEditingController(text: widget.asset?.floor ?? '');
  late final _department = TextEditingController(text: widget.asset?.department ?? '');
  late final _warrantyExpiry = TextEditingController(text: widget.asset?.warrantyExpiry ?? '');

  final List<_BulkUnit> _units = [_BulkUnit()];

  XFile? _billPhoto;
  String? _error;
  String? _bulkImportNote;

  @override
  void initState() {
    super.initState();
    _vendorId = widget.asset?.vendorId;
    _roomId = widget.asset?.roomId;
    Future.microtask(() {
      ref.read(assetsViewModelProvider.notifier).loadCatalogue();
      ref.read(roomsViewModelProvider.notifier).loadAll();
    });
  }

  @override
  void dispose() {
    _categoryName.dispose();
    _name.dispose();
    _brand.dispose();
    _model.dispose();
    _serialNumber.dispose();
    _purchaseDate.dispose();
    _purchaseCost.dispose();
    _floor.dispose();
    _department.dispose();
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

  // ── Bulk CSV template: download the current rows, or replace them with a
  // filled-in sheet — mirrors downloadBulkTemplate/importBulkTemplate in
  // AssetsPanel.jsx. The room column is a room *number* a spreadsheet
  // round-trips, matched back to a room id by number at import time.

  bool _csvBusy = false;

  Future<void> _downloadBulkTemplate() async {
    if (_csvBusy) return;
    setState(() {
      _csvBusy = true;
      _bulkImportNote = null;
    });
    try {
      const headers = ['Name (optional)', 'Serial number', 'Room number', 'Floor', 'Location description'];
      final rows = [
        headers,
        for (final u in _units) [u.name.text, u.serialNumber.text, '', u.floor.text, u.department.text],
      ];
      final csv = rows.map((row) => row.map((cell) => '"${cell.replaceAll('"', '""')}"').join(',')).join('\r\n');

      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/asset-bulk-template.csv');
      await file.writeAsString(csv);
      await SharePlus.instance.share(ShareParams(files: [XFile(file.path)], subject: 'Asset bulk template'));
    } catch (e) {
      if (mounted) setState(() => _bulkImportNote = 'Could not prepare the template: $e');
    } finally {
      if (mounted) setState(() => _csvBusy = false);
    }
  }

  Future<void> _uploadBulkTemplate() async {
    if (_csvBusy) return;
    setState(() {
      _csvBusy = true;
      _bulkImportNote = null;
    });
    try {
      await _doUploadBulkTemplate();
    } catch (e) {
      if (mounted) setState(() => _bulkImportNote = 'Could not read that file: $e');
    } finally {
      if (mounted) setState(() => _csvBusy = false);
    }
  }

  Future<void> _doUploadBulkTemplate() async {
    final result = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: ['csv'], withData: true);
    final bytes = result?.files.singleOrNull?.bytes;
    if (bytes == null) return;

    String text;
    try {
      text = utf8.decode(bytes);
    } catch (_) {
      text = String.fromCharCodes(bytes);
    }
    final rows = _parseCsv(text);
    if (rows.isEmpty) {
      setState(() => _bulkImportNote = 'That file has no rows.');
      return;
    }
    // The header row is skipped by position, not by matching its text — a
    // fragile promise to keep column headers byte-identical would break the
    // moment someone edits the sheet in Excel; the column order is the real
    // contract, same as the web app's importer.
    final looksLikeHeader = rows.first.any((c) => RegExp('name|room|floor|location', caseSensitive: false).hasMatch(c));
    final dataRows = looksLikeHeader ? rows.skip(1).toList() : rows;
    if (dataRows.isEmpty) {
      setState(() => _bulkImportNote = 'That file has a header row but no data.');
      return;
    }
    if (dataRows.length > 200) {
      setState(() => _bulkImportNote = 'That\'s a lot for one batch (200 max) — split it into two files.');
      return;
    }

    final rooms = ref.read(roomsViewModelProvider).rooms;
    final unmatchedRooms = <String>[];
    final imported = <_BulkUnit>[];
    for (var i = 0; i < dataRows.length; i++) {
      final row = dataRows[i];
      String cell(int index) => index < row.length ? row[index].trim() : '';
      final roomNumber = cell(2);
      RoomListing? room;
      if (roomNumber.isNotEmpty) {
        for (final r in rooms) {
          if (r.roomNumber == roomNumber) {
            room = r;
            break;
          }
        }
        if (room == null) unmatchedRooms.add('row ${i + 1} ("$roomNumber")');
      }
      imported.add(
        _BulkUnit()
          ..name.text = cell(0)
          ..serialNumber.text = cell(1)
          ..roomId = room?.id
          ..floor.text = cell(3)
          ..department.text = cell(4),
      );
    }

    setState(() {
      for (final u in _units) {
        u.dispose();
      }
      _units
        ..clear()
        ..addAll(imported);
      _bulkImportNote = unmatchedRooms.isEmpty
          ? null
          : 'Imported ${imported.length} row${imported.length == 1 ? '' : 's'}. Room number not found for '
                '${unmatchedRooms.join(', ')} — pick it by hand or leave it not room-bound.';
    });
  }

  // A small hand-rolled parser rather than a library: quoted fields with
  // escaped "" are the one thing a plain split(',') gets wrong, and that's
  // the only CSV feature this needs — same approach as parseCsv in
  // AssetsPanel.jsx.
  List<List<String>> _parseCsv(String text) {
    final rows = <List<String>>[];
    var row = <String>[];
    var field = StringBuffer();
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      final c = text[i];
      if (inQuotes) {
        if (c == '"' && i + 1 < text.length && text[i + 1] == '"') {
          field.write('"');
          i++;
        } else if (c == '"') {
          inQuotes = false;
        } else {
          field.write(c);
        }
      } else if (c == '"') {
        inQuotes = true;
      } else if (c == ',') {
        row.add(field.toString());
        field = StringBuffer();
      } else if (c == '\n' || c == '\r') {
        if (c == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++;
        row.add(field.toString());
        rows.add(row);
        row = <String>[];
        field = StringBuffer();
      } else {
        field.write(c);
      }
    }
    if (field.isNotEmpty || row.isNotEmpty) {
      row.add(field.toString());
      rows.add(row);
    }
    return rows.where((r) => r.any((c) => c.trim().isNotEmpty)).toList();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(assetsViewModelProvider);
    final roomsState = ref.watch(roomsViewModelProvider);
    final categoryOptions = <String>{...state.categories.map((c) => c.name), ..._kSuggestedCategories}.toList()..sort();

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit asset' : 'Register an asset')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            if (_error != null) ...[
              _ErrorBanner(_error!),
              const SizedBox(height: AppTheme.s16),
            ],
            if (!_isEdit) ...[
              Align(
                alignment: Alignment.centerLeft,
                child: ModeToggle(
                  options: const {'single': 'Single', 'bulk': 'Bulk register'},
                  selected: _bulk ? 'bulk' : 'single',
                  onSelect: (v) => setState(() => _bulk = v == 'bulk'),
                ),
              ),
              const SizedBox(height: AppTheme.s16),
            ],
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Category', number: 1),
                  const SizedBox(height: AppTheme.s12),
                  const RequiredLabel('Category'),
                  const SizedBox(height: 4),
                  _CategoryField(controller: _categoryName, options: categoryOptions),
                  const SizedBox(height: 4),
                  const Text("Pick from the list or type a new one — it's added the first time it's used.", style: _kFieldHintStyle),
                  if (_bulk && !_isEdit) ...[
                    const SizedBox(height: 2),
                    const Text('Every unit in this batch shares one category.', style: _kFieldHintStyle),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s16),

            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Purchase details', number: 2),
                  const SizedBox(height: AppTheme.s12),

                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          children: [
                            NeuField(controller: _brand, label: 'Brand / model', hint: 'Brand'),
                            const SizedBox(height: AppTheme.s8),
                            NeuField(controller: _model, label: '', hint: 'Model'),
                          ],
                        ),
                      ),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(
                        child: (!_bulk || _isEdit)
                            ? NeuField(controller: _serialNumber, label: 'Serial number', hint: 'Optional')
                            : NeuField(
                                controller: _purchaseDate,
                                label: 'Purchase date',
                                hint: 'Tap to pick',
                                readOnly: true,
                                onTap: () => _pickDate(_purchaseDate),
                              ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s12),

                  if (!_bulk || _isEdit)
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
                    )
                  else
                    NeuField(controller: _purchaseCost, label: 'Cost per unit', keyboardType: TextInputType.number),
                  const SizedBox(height: AppTheme.s12),

                  const Text('Vendor (optional)', style: _kFieldLabelStyle),
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

                  const SizedBox(height: AppTheme.s16),
                  Text('Purchase bill (optional)', style: _kFieldLabelStyle),
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

                  if (!_isEdit) ...[
                    const SizedBox(height: AppTheme.s12),
                    NeuField(
                      controller: _warrantyExpiry,
                      label: 'Company warranty until (optional)',
                      hint: 'Tap to pick',
                      readOnly: true,
                      onTap: () => _pickDate(_warrantyExpiry),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _bulk ? "Leave blank if there's no maker's warranty on this batch." : "Leave blank if there's no maker's warranty.",
                      style: _kFieldHintStyle,
                    ),
                  ],
                ],
              ),
            ),

            if (!_bulk || _isEdit) ...[
              const SizedBox(height: AppTheme.s16),
              NeuCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SectionLabel('Installation details', number: 3),
                    const SizedBox(height: AppTheme.s12),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          flex: 2,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Room', style: _kFieldLabelStyle),
                              const SizedBox(height: 4),
                              _RoomDropdown(value: _roomId, rooms: roomsState.rooms, onChanged: (v) => setState(() => _roomId = v)),
                            ],
                          ),
                        ),
                        const SizedBox(width: AppTheme.s8),
                        Expanded(child: NeuField(controller: _floor, label: 'Floor', hint: '2')),
                      ],
                    ),
                    const SizedBox(height: 4),
                    const Text('Leave unset for lobby, kitchen or common-area equipment.', style: _kFieldHintStyle),
                    const SizedBox(height: AppTheme.s12),
                    NeuField(controller: _department, label: 'Location description', hint: 'Kitchen, Lobby, Reception, Poolside…'),
                    const SizedBox(height: 4),
                    const Text("A short label, not a sentence — it's also used to build the asset's name below.", style: _kFieldHintStyle),
                    const SizedBox(height: AppTheme.s12),
                    NeuField(controller: _name, label: 'Name', hint: 'Filled in from category and room above — edit freely', required: true),
                    if (_isEdit) ...[
                      const SizedBox(height: AppTheme.s12),
                      const Text('Asset tag', style: _kFieldLabelStyle),
                      const SizedBox(height: 4),
                      Text(
                        "${widget.asset!.assetTag ?? ''} — generated automatically, can't be changed.",
                        style: const TextStyle(color: AppTheme.text, fontSize: 12.5),
                      ),
                    ],
                  ],
                ),
              ),
            ],
            if (_bulk && !_isEdit) ...[
              const SizedBox(height: AppTheme.s16),
              NeuCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Units ${_units.length} so far', style: _kSectionHeadingStyle),
                    const SizedBox(height: AppTheme.s8),
                    Row(
                      children: [
                        Expanded(
                          child: NeuButton(
                            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: AppTheme.s12),
                            onPressed: _csvBusy ? null : _downloadBulkTemplate,
                            child: _csvBusy
                                ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent))
                                : const Text('Download template', textAlign: TextAlign.center, maxLines: 2, softWrap: true, style: TextStyle(fontSize: 11.5)),
                          ),
                        ),
                        const SizedBox(width: AppTheme.s8),
                        Expanded(
                          child: NeuButton(
                            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: AppTheme.s12),
                            onPressed: _csvBusy ? null : _uploadBulkTemplate,
                            child: _csvBusy
                                ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.accent))
                                : const Text('Upload filled template', textAlign: TextAlign.center, maxLines: 2, softWrap: true, style: TextStyle(fontSize: 11.5)),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Download the template, fill in a room number (or floor / location) per row in Excel or Sheets, save as CSV, and upload it back — or just add rows by hand below.',
                      style: _kFieldHintStyle,
                    ),
                    if (_bulkImportNote != null) ...[
                      const SizedBox(height: 4),
                      Text(_bulkImportNote!, style: const TextStyle(color: AppTheme.accent, fontSize: 11.5)),
                    ],
                    const SizedBox(height: AppTheme.s12),
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
                              const Text('Room', style: _kFieldLabelStyle),
                              const SizedBox(height: 4),
                              _RoomDropdown(
                                value: _units[i].roomId,
                                rooms: roomsState.rooms,
                                onChanged: (v) => setState(() => _units[i].roomId = v),
                              ),
                              const SizedBox(height: AppTheme.s8),
                              NeuField(controller: _units[i].floor, label: 'Floor'),
                              const SizedBox(height: AppTheme.s8),
                              NeuField(controller: _units[i].department, label: 'Location description'),
                              const SizedBox(height: AppTheme.s8),
                              NeuField(controller: _units[i].name, label: 'Name (auto-filled)', hint: 'Split AC 1.5T · Room 101'),
                              const SizedBox(height: AppTheme.s8),
                              NeuField(controller: _units[i].serialNumber, label: 'Serial number (optional)'),
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
    if (_categoryName.text.trim().isEmpty) {
      setState(() => _error = 'Enter or choose a category.');
      return;
    }

    final vm = ref.read(assetsViewModelProvider.notifier);
    final categoryId = await vm.resolveCategoryId(_categoryName.text.trim());
    if (categoryId == null) {
      if (!mounted) return;
      setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not resolve that category.');
      return;
    }

    if (_bulk && !_isEdit) {
      if (_units.any((u) => u.name.text.trim().isEmpty && u.department.text.trim().isEmpty && u.roomId == null)) {
        setState(() => _error = 'Every unit needs a room, a location, or a name to tell it apart from the others.');
        return;
      }
      final formMap = <String, dynamic>{
        'categoryId': '$categoryId',
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
      'categoryId': '$categoryId',
      'brand': _brand.text.trim(),
      'model': _model.text.trim(),
      'serialNumber': _serialNumber.text.trim(),
      'purchaseDate': _purchaseDate.text.trim(),
      'purchaseCost': _purchaseCost.text.trim().isEmpty ? '' : (num.tryParse(_purchaseCost.text.trim()) ?? '').toString(),
      'roomId': _roomId?.toString() ?? '',
      'floor': _floor.text.trim(),
      'department': _department.text.trim(),
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
            'roomId': u.roomId?.toString() ?? '',
            'floor': u.floor.text.trim(),
            'department': u.department.text.trim(),
          })
      .toList());
}

/// A styled stand-in for a native combobox — mirrors CategoryField in
/// AssetsPanel.jsx: type freely, or pick a suggestion (existing categories
/// plus the same starter list the web app offers).
///
/// This is deliberately an inline list under the field, in the normal widget
/// tree, rather than Flutter's built-in [Autocomplete] — that widget shows
/// its suggestions in the app-wide [Overlay], and if that overlay entry
/// isn't torn down cleanly on blur (a real bug on Flutter Web/Chrome), it's
/// left sitting invisibly on top of the whole page, swallowing every pointer
/// event — including the page's own scroll — until the app is reloaded. An
/// inline list can't do that: closing it just removes a few widgets from
/// this subtree, the same as any other conditionally-shown Column child.
class _CategoryField extends StatefulWidget {
  final TextEditingController controller;
  final List<String> options;

  const _CategoryField({required this.controller, required this.options});

  @override
  State<_CategoryField> createState() => _CategoryFieldState();
}

class _CategoryFieldState extends State<_CategoryField> {
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_onFocusChange);
    widget.controller.addListener(_onTextChange);
  }

  void _onFocusChange() => setState(() {});
  void _onTextChange() => setState(() {});

  @override
  void dispose() {
    _focusNode.removeListener(_onFocusChange);
    widget.controller.removeListener(_onTextChange);
    _focusNode.dispose();
    super.dispose();
  }

  List<String> get _matches {
    final needle = widget.controller.text.trim().toLowerCase();
    if (needle.isEmpty) return widget.options;
    return widget.options.where((o) => o.toLowerCase().contains(needle)).toList();
  }

  void _pick(String name) {
    widget.controller.text = name;
    _focusNode.unfocus();
  }

  @override
  Widget build(BuildContext context) {
    final matches = _matches;
    final open = _focusNode.hasFocus && matches.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NeuField(controller: widget.controller, focusNode: _focusNode, label: '', hint: 'AC, Lift, Generator…'),
        if (open)
          Container(
            margin: const EdgeInsets.only(top: 4),
            constraints: const BoxConstraints(maxHeight: 180),
            decoration: BoxDecoration(color: AppTheme.card, borderRadius: BorderRadius.circular(AppTheme.rSmall), border: Border.all(color: AppTheme.border)),
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.symmetric(vertical: 4),
              children: [
                for (final name in matches)
                  GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    // onTapDown, not onTap — a tap on this item first blurs
                    // the field (closing this list) before an onTap would
                    // fire, so the pick would land on nothing. Down fires
                    // first, while the list is still here to hit-test.
                    onTapDown: (_) => _pick(name),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: 8),
                      child: Text(name, style: const TextStyle(fontSize: 13.5, color: AppTheme.text)),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _RoomDropdown extends StatelessWidget {
  final int? value;
  final List<RoomListing> rooms;
  final ValueChanged<int?> onChanged;

  const _RoomDropdown({required this.value, required this.rooms, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return NeuPressed(
      padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int?>(
          isExpanded: true,
          value: value,
          dropdownColor: AppTheme.card,
          hint: const Text('Not room-bound', style: TextStyle(color: AppTheme.muted, fontSize: 13.5)),
          items: [
            const DropdownMenuItem(value: null, child: Text('Not room-bound', style: TextStyle(fontSize: 13.5))),
            for (final r in rooms) DropdownMenuItem(value: r.id, child: Text('Room ${r.roomNumber}', style: const TextStyle(fontSize: 13.5))),
          ],
          onChanged: onChanged,
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
