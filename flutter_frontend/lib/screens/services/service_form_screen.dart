import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/lodge_service.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Add or edit a service — mirrors the 'form' modal in ServicesPanel.jsx.
/// Price is what the guest pays, GST included. Past use keeps its old price.
Future<void> showServiceFormScreen(BuildContext context, {LodgeService? service}) {
  return Navigator.of(context).push(MaterialPageRoute(builder: (_) => ServiceFormScreen(service: service)));
}

class ServiceFormScreen extends ConsumerStatefulWidget {
  final LodgeService? service;
  const ServiceFormScreen({super.key, this.service});

  @override
  ConsumerState<ServiceFormScreen> createState() => _ServiceFormScreenState();
}

class _ServiceFormScreenState extends ConsumerState<ServiceFormScreen> {
  bool get _isEdit => widget.service != null;
  late final _name = TextEditingController(text: widget.service?.name ?? '');
  late final _price = TextEditingController(text: widget.service == null ? '' : widget.service!.price.toString());
  late final _gst = TextEditingController(text: (widget.service?.gstRatePercent ?? 18).toString());
  late final _unitOther = TextEditingController(
    text: widget.service != null && !kServiceUnitSuggestions.contains(widget.service!.unitLabel) ? widget.service!.unitLabel : '',
  );
  late String? _unit = widget.service == null
      ? 'use'
      : (kServiceUnitSuggestions.contains(widget.service!.unitLabel) ? widget.service!.unitLabel : null);
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _price.dispose();
    _gst.dispose();
    _unitOther.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a service name.');
      return;
    }
    final price = num.tryParse(_price.text.trim());
    if (_price.text.trim().isEmpty || price == null || price < 0) {
      setState(() => _error = 'Enter the price per use.');
      return;
    }
    final unitLabel = (_unit ?? _unitOther.text.trim()).trim();
    final ok = await ref.read(lodgeServicesViewModelProvider.notifier).saveService(
      {
        'name': _name.text.trim(),
        'unitLabel': unitLabel.isEmpty ? 'use' : unitLabel,
        'price': price,
        'gstRatePercent': num.tryParse(_gst.text.trim()) ?? 18,
      },
      id: widget.service?.id,
    );
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(lodgeServicesViewModelProvider).error ?? 'Could not save the service.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(lodgeServicesViewModelProvider);
    final isOther = _unit == null;

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit service' : 'Add service')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_error != null) ...[
                    _ErrorBanner(_error!),
                    const SizedBox(height: AppTheme.s16),
                  ],
                  const Text('Price is what the guest pays, GST included. Past use keeps its old price.', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _name, label: 'Service name', required: true, hint: 'Private pool', forceCapitalizeWords: true),
                  const SizedBox(height: AppTheme.s12),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: NeuField(controller: _price, label: 'Price', required: true, keyboardType: TextInputType.number)),
                      const SizedBox(width: AppTheme.s12),
                      Expanded(child: NeuField(controller: _gst, label: 'GST %', keyboardType: TextInputType.number)),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s12),
                  const RequiredLabel('Per'),
                  const SizedBox(height: AppTheme.s8),
                  OptionDropdown(
                    values: [...kServiceUnitSuggestions, '__other'],
                    labels: {for (final u in kServiceUnitSuggestions) u: u, '__other': 'Other…'},
                    selected: isOther ? '__other' : _unit,
                    onSelect: (v) => setState(() => _unit = v == '__other' ? null : v),
                  ),
                  if (isOther) ...[
                    const SizedBox(height: AppTheme.s8),
                    NeuField(controller: _unitOther, label: '', hint: 'Type your own'),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: state.submitting ? null : _submit,
              child: state.submitting
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Save'),
            ),
          ],
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
