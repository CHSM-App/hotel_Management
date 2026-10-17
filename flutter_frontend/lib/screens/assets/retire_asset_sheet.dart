import 'package:flutter/material.dart';
import '../../widgets/compact_date_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/asset.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart' show SectionLabel, SectionDivider;
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
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        titleSpacing: AppTheme.s4,
        title: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [AppTheme.accent, Color(0xFF10499A)],
                ),
                borderRadius: BorderRadius.circular(AppTheme.rSmall + 2),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x331457AD),
                    offset: Offset(0, 3),
                    blurRadius: 8,
                  ),
                ],
              ),
              child: const Icon(Icons.inventory_2_rounded, color: Colors.white, size: 18),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: Text(
                alreadyRetired ? 'Edit dead stock details' : 'Retire asset',
                overflow: TextOverflow.ellipsis,
                maxLines: 1,
              ),
            ),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(22 + 3),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.only(bottom: AppTheme.s8),
                child: Text(
                  [widget.asset.name, widget.asset.assetTag].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
                ),
              ),
              Container(
                height: 3,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(colors: [AppTheme.accent, Color(0x001457AD)]),
                ),
              ),
            ],
          ),
        ),
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s16),
              children: [
                if (!alreadyRetired) ...[
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8 + 2),
                    decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
                    child: Row(
                      children: [
                        const Icon(Icons.inventory_2_outlined, size: 16, color: AppTheme.danger),
                        const SizedBox(width: AppTheme.s8),
                        Expanded(
                          child: Text(
                            'This moves the asset out of the active register and into Dead Stock.',
                            style: const TextStyle(color: AppTheme.danger, fontSize: 12.5, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppTheme.s8),
                ],
                if (_error != null) ...[
                  Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                  const SizedBox(height: AppTheme.s8),
                ],
                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.elevated,
                  padding: const EdgeInsets.all(AppTheme.s12 + 2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SectionLabel('When & why', number: 1, icon: Icons.event_busy_rounded),
                      const SizedBox(height: AppTheme.s12),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: NeuField(
                              dense: true,
                              controller: _deadDate,
                              label: 'Dead since',
                              readOnly: true,
                              onTap: _pickDeadDate,
                            ),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(
                            child: NeuField(
                              dense: true,
                              controller: _recoveryCost,
                              label: 'Recovery amount',
                              hint: '0',
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppTheme.s8),
                      NeuField(
                        dense: true,
                        controller: _deadReason,
                        label: 'Reason',
                        required: true,
                        errorText: _reasonError,
                        focusNode: _reasonFocus,
                        hint: 'Beyond repair, obsolete, damaged, lost…',
                        onChanged: (_) => setState(() {}),
                      ),

                      const SectionDivider(),
                      const SectionLabel('Disposal', number: 2, icon: Icons.delete_sweep_rounded),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        dense: true,
                        controller: _disposalNote,
                        label: 'Disposal',
                        hint: 'Scrapped, sold, donated, discarded…',
                      ),
                      const SizedBox(height: AppTheme.s8),
                      NeuField(
                        dense: true,
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
                const SizedBox(height: AppTheme.s16),
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
        ),
      ),
    );
  }
}

extension on String {
  /// First 10 characters — an ISO date/datetime's own yyyy-MM-dd prefix.
  String get slice10 => length <= 10 ? this : substring(0, 10);
}
