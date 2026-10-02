import 'dart:typed_data';

import 'package:excel/excel.dart' as xl;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/menu.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../bookings/receipt_download.dart';
import '../theme.dart';

/// "Import from Excel" for the menu — mirrors the web dashboard's
/// MenuExcelImport.jsx: same columns (Section, Item Name, Description, Price,
/// Type), same "a section or item that already exists by name is updated,
/// not duplicated" behaviour, same POST /menu/import. Read here with the
/// `excel` package instead of read-excel-file since there is no browser.
Future<void> showMenuImportDialog(BuildContext context) {
  return showDialog(context: context, builder: (_) => const _MenuImportDialog());
}

const _kTemplateHeaders = ['Section', 'Item Name', 'Description', 'Price', 'Type'];
const _kTemplateExample = ['Starters', 'Veg Manchurian', 'Crispy vegetable balls in tangy sauce', '180', 'Veg'];

class _MenuImportDialog extends ConsumerStatefulWidget {
  const _MenuImportDialog();

  @override
  ConsumerState<_MenuImportDialog> createState() => _MenuImportDialogState();
}

class _MenuImportDialogState extends ConsumerState<_MenuImportDialog> {
  bool _busy = false;
  String? _error;
  MenuImportResult? _result;

  Future<void> _downloadTemplate() async {
    final excel = xl.Excel.createExcel();
    final sheet = excel['Menu'];
    sheet.appendRow(_kTemplateHeaders.map((h) => xl.TextCellValue(h)).toList());
    sheet.appendRow([
      xl.TextCellValue(_kTemplateExample[0]),
      xl.TextCellValue(_kTemplateExample[1]),
      xl.TextCellValue(_kTemplateExample[2]),
      xl.DoubleCellValue(double.parse(_kTemplateExample[3])),
      xl.TextCellValue(_kTemplateExample[4]),
    ]);
    final defaultSheet = excel.getDefaultSheet();
    if (defaultSheet != null && defaultSheet != 'Menu') excel.delete(defaultSheet);
    final bytes = excel.encode();
    if (bytes == null) return;
    await saveBytesToDevice(Uint8List.fromList(bytes), 'menu-import-template.xlsx');
  }

  String _cellText(List<xl.Data?> row, int col) {
    if (col < 0 || col >= row.length) return '';
    return (row[col]?.value?.toString() ?? '').trim();
  }

  Future<void> _pickAndImport() async {
    setState(() {
      _error = null;
      _result = null;
    });

    final picked = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: ['xlsx'], withData: true);
    final bytes = picked?.files.singleOrNull?.bytes;
    if (bytes == null) return;

    setState(() => _busy = true);
    try {
      final workbook = xl.Excel.decodeBytes(bytes);
      if (workbook.tables.isEmpty) throw 'That file has no sheets.';
      final sheet = workbook.tables[workbook.tables.keys.first]!;
      if (sheet.rows.isEmpty) throw 'That file has no rows to import.';

      final header = sheet.rows.first.map((c) => (c?.value?.toString() ?? '').trim().toLowerCase()).toList();
      final sectionCol = header.indexOf('section');
      final nameCol = header.indexOf('item name');
      final descCol = header.indexOf('description');
      final priceCol = header.indexOf('price');
      final typeCol = header.indexOf('type');
      if (sectionCol < 0 || nameCol < 0 || priceCol < 0) {
        throw 'Columns must be: Section, Item Name, Description, Price, Type.';
      }

      final rows = <Map<String, dynamic>>[];
      for (final row in sheet.rows.skip(1)) {
        if (row.every((c) => (c?.value?.toString() ?? '').trim().isEmpty)) continue;
        final typeText = _cellText(row, typeCol);
        rows.add({
          'section': _cellText(row, sectionCol),
          'name': _cellText(row, nameCol),
          'description': _cellText(row, descCol),
          'price': _cellText(row, priceCol),
          'foodType': RegExp('non', caseSensitive: false).hasMatch(typeText) ? 'NON_VEG' : 'VEG',
        });
      }
      if (rows.isEmpty) throw 'That file has no rows to import.';

      final result = await ref.read(menuViewModelProvider.notifier).importMenu(rows);
      if (!mounted) return;
      if (result == null) {
        setState(() => _error = ref.read(menuViewModelProvider).error ?? 'Could not import that file.');
      } else {
        setState(() => _result = result);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppTheme.card,
      insetPadding: const EdgeInsets.all(AppTheme.s16),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppTheme.s24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Import menu from Excel',
                      style: TextStyle(color: AppTheme.heading, fontSize: 18, fontWeight: FontWeight.w700),
                    ),
                  ),
                  InkWell(
                    onTap: _busy ? null : () => Navigator.pop(context),
                    borderRadius: BorderRadius.circular(AppTheme.rSmall),
                    child: const Padding(
                      padding: EdgeInsets.all(4),
                      child: Icon(Icons.close_rounded, color: AppTheme.muted, size: 20),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.s8),
              const Text(
                'Columns: Section, Item Name, Description, Price, Type (Veg / Non-Veg). '
                'A section or item that already exists by name is updated, not duplicated — '
                'safe to re-upload after fixing a mistake.',
                style: TextStyle(color: AppTheme.text, fontSize: 12.5, height: 1.4),
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: _busy ? null : _downloadTemplate,
                  child: const Text('Download a template'),
                ),
              ),
              const SizedBox(height: AppTheme.s12),
              if (_error != null) ...[
                Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 13)),
                const SizedBox(height: AppTheme.s12),
              ],
              if (_result != null) _ImportResultView(result: _result!),
              const SizedBox(height: AppTheme.s16),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(onPressed: _busy ? null : () => Navigator.pop(context), child: const Text('Done')),
                  const SizedBox(width: AppTheme.s8),
                  NeuButton(
                    primary: true,
                    onPressed: _busy ? null : _pickAndImport,
                    child: _busy
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Choose file'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ImportResultView extends StatelessWidget {
  final MenuImportResult result;
  const _ImportResultView({required this.result});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${result.created} added, ${result.updated} updated'
          '${result.failed > 0 ? ', ${result.failed} failed' : ''}.',
          style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13),
        ),
        if (result.errors.isNotEmpty) ...[
          const SizedBox(height: 6),
          for (final e in result.errors)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                'Row ${e.row}${e.name != null ? ' (${e.name})' : ''}: ${e.message}',
                style: const TextStyle(color: AppTheme.danger, fontSize: 11.5),
              ),
            ),
        ],
      ],
    );
  }
}
