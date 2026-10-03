import 'package:flutter/material.dart';
import '../../widgets/compact_date_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// Retire an asset / correct its dead stock record — mirrors the retire
/// modal in AssetsPanel.jsx: Dead since, Reason (required), Disposal,
/// Recovery amount, Handled by (required). Also reused to edit the same
/// fields on an asset that's already RETIRED, pre-filled from what's on
/// file, the same way openRetireForm(asset) does on the web.
Future<bool> showRetireAssetSheet(BuildContext context, {required Asset asset}) {
  return Navigator.of(context)
      .push<bool>(MaterialPageRoute(builder: (_) => RetireAssetSheet(asset: asset)))
      .then((v) => v ?? false);
}

class RetireAssetSheet extends ConsumerStatefulWidget {
  final Asset asset;
  const RetireAssetSheet({super.key, required this.asset});

  @override
  ConsumerState<RetireAssetSheet> createState() => _RetireAssetSheetState();
}

class _RetireAssetSheetState extends ConsumerState<RetireAssetSheet> {
  late final _deadDate = TextEditingController(
    text: widget.asset.deadDate?.slice10 ?? DateTime.now().toIso8601String().slice10,
  );
  late final _deadReason = TextEditingController(text: widget.asset.deadReason ?? '');
  late final _disposalNote = TextEditingController(text: widget.asset.disposalNote ?? '');
  late final _recoveryCost = TextEditingController(text: widget.asset.recoveryCost?.toString() ?? '');
  late final _disposedBy = TextEditingController(text: widget.asset.disposedBy ?? '');

  final _reasonFocus = FocusNode();
  final _disposedByFocus = FocusNode();

  bool _submitAttempted = false;
  String? _error;

  String? get _reasonError =>
      (_submitAttempted && _deadReason.text.trim().isEmpty) ? 'Enter why this asset is dead.' : null;

  String? get _disposedByError =>
      (_submitAttempted && _disposedBy.text.trim().isEmpty) ? 'Enter who handled this.' : null;

  @override
  void dispose() {
    _deadDate.dispose();
    _deadReason.dispose();
    _disposalNote.dispose();
    _recoveryCost.dispose();
    _disposedBy.dispose();
    _reasonFocus.dispose();
    _disposedByFocus.dispose();
    super.dispose();
  }

  Future<void> _pickDeadDate() async {
    final now = DateTime.now();
    final initial = DateTime.tryParse(_deadDate.text) ?? now;
    final picked = await showAppDatePicker(
      context: context,
      firstDate: DateTime(now.year - 15),
      lastDate: now,
      initialDate: initial.isAfter(now) ? now : initial,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() => _deadDate.text = picked.toIso8601String().slice10);
  }

  Future<void> _save() async {
    setState(() => _submitAttempted = true);
    if (_reasonError != null) {
      _reasonFocus.requestFocus();
      return;
    }
    if (_disposedByError != null) {
      _disposedByFocus.requestFocus();
      return;
    }
    final deadStock = {
      'deadDate': _deadDate.text.trim(),
      'deadReason': _deadReason.text.trim(),
      'disposalNote': _disposalNote.text.trim(),
      'recoveryCost': _recoveryCost.text.trim(),
      'disposedBy': _disposedBy.text.trim(),
    };
    final ok = await ref
        .read(assetsViewModelProvider.notifier)
        .setStatus(widget.asset.id, 'RETIRED', deadStock: deadStock);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context, true);
    } else {
      setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not save that asset.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(assetsViewModelProvider).submitting;
    final alreadyRetired = widget.asset.status == 'RETIRED';
    return Scaffold(
      appBar: AppBar(title: Text(alreadyRetired ? 'Edit dead stock details' : 'Retire asset')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              const SizedBox(height: AppTheme.s12),
            ],
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  NeuField(
                    controller: _deadDate,
                    label: 'Dead since',
                    readOnly: true,
                    onTap: _pickDeadDate,
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _deadReason,
                    label: 'Reason',
                    required: true,
                    errorText: _reasonError,
                    focusNode: _reasonFocus,
                    hint: 'Beyond repair, obsolete, damaged, lost…',
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _disposalNote,
                    label: 'Disposal',
                    hint: 'Scrapped, sold, donated, discarded…',
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _recoveryCost,
                    label: 'Recovery amount',
                    hint: 'Anything recovered from scrap/sale',
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(
                    controller: _disposedBy,
                    label: 'Handled by',
                    required: true,
                    errorText: _disposedByError,
                    focusNode: _disposedByFocus,
                    onChanged: (_) => setState(() {}),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: submitting ? null : _save,
              child: submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(alreadyRetired ? 'Save' : 'Retire asset'),
            ),
          ],
        ),
      ),
    );
  }
}

extension on String {
  /// First 10 characters — an ISO date/datetime's own yyyy-MM-dd prefix.
  String get slice10 => length <= 10 ? this : substring(0, 10);
}
