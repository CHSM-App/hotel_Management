import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/constant.dart';
import '../../domain/models/lodge_service.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../../widgets/photo_source_sheet.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Add or edit a service — mirrors the 'form' modal in ServicesPanel.jsx.
/// Price is what the guest pays, GST included. Past use keeps its old price.
///
/// Styled the same way as the New booking, Add room and Start a service
/// pages: a gradient header icon, numbered sections with icon badges on one
/// card, field-level errors that only appear once Save has been tried.
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
  final _scrollController = ScrollController();

  // One key per required section, in the order the form asks them — so a
  // failed submit can jump straight to the first thing wrong instead of
  // leaving the desk to hunt for a red line it may not have noticed.
  final _nameKey = GlobalKey();
  final _priceKey = GlobalKey();
  final _unitKey = GlobalKey();

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
  XFile? _newPhoto;
  bool _removeImage = false;
  String? _error;

  /// Whether Save has been pressed at least once — a field that hasn't been
  /// submitted yet has nothing to be wrong about, so nothing turns red until
  /// the desk actually tries to save.
  bool _submitAttempted = false;

  String? get _nameError {
    if (!_submitAttempted) return null;
    return _name.text.trim().isEmpty ? 'Enter a service name.' : null;
  }

  String? get _priceError {
    if (!_submitAttempted) return null;
    final price = num.tryParse(_price.text.trim());
    return (_price.text.trim().isEmpty || price == null || price < 0) ? 'Enter the price per use.' : null;
  }

  String? get _unitError {
    if (!_submitAttempted || _unit != null) return null;
    return _unitOther.text.trim().isEmpty ? 'Enter what this is priced per.' : null;
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _name.dispose();
    _price.dispose();
    _gst.dispose();
    _unitOther.dispose();
    super.dispose();
  }

  /// Jumps the page to [key]'s section so a failed submit lands the desk on
  /// the very box that stopped it, rather than trusting them to spot a red
  /// line somewhere on the screen.
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

  Future<void> _submit() async {
    setState(() => _submitAttempted = true);

    // Checked in the order the form asks them, so the scroll lands on
    // whichever one the desk would hit first reading top to bottom.
    if (_nameError != null) {
      _scrollToError(_nameKey);
      return;
    }
    if (_priceError != null) {
      _scrollToError(_priceKey);
      return;
    }
    if (_unitError != null) {
      _scrollToError(_unitKey);
      return;
    }

    final price = num.parse(_price.text.trim());
    final unitLabel = (_unit ?? _unitOther.text.trim()).trim();
    final gst = num.tryParse(_gst.text.trim()) ?? 18;

    dynamic body;
    if (_newPhoto != null || _removeImage) {
      final fields = <String, dynamic>{
        'name': _name.text.trim(),
        'unitLabel': unitLabel.isEmpty ? 'use' : unitLabel,
        'price': '$price',
        'gstRatePercent': '$gst',
      };
      if (_newPhoto != null) {
        fields['image'] = dio.MultipartFile.fromFileSync(_newPhoto!.path, filename: _newPhoto!.name);
      } else {
        fields['removeImage'] = 'true';
      }
      body = dio.FormData.fromMap(fields);
    } else {
      body = {
        'name': _name.text.trim(),
        'unitLabel': unitLabel.isEmpty ? 'use' : unitLabel,
        'price': price,
        'gstRatePercent': gst,
      };
    }
    final ok = await ref.read(lodgeServicesViewModelProvider.notifier).saveService(
      body,
      id: widget.service?.id,
    );
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(lodgeServicesViewModelProvider).error ?? 'Could not save the service.');
    }
  }

  Widget _photoPicker() {
    final existing = widget.service?.image;
    ImageProvider? preview;
    if (_newPhoto != null) {
      preview = FileImage(File(_newPhoto!.path));
    } else if (!_removeImage && existing != null) {
      preview = NetworkImage('$baseUrl/service-images/$existing');
    }

    return Wrap(
      spacing: AppTheme.s8,
      runSpacing: AppTheme.s8,
      children: [
        if (preview != null)
          PhotoThumb(
            imageProvider: preview,
            onRemove: () => setState(() {
              if (_newPhoto != null) {
                _newPhoto = null;
              } else {
                _removeImage = true;
              }
            }),
          )
        else
          AddPhotoTile(onTap: _pickPhoto),
      ],
    );
  }

  Future<void> _pickPhoto() async {
    final source = await showPhotoSourceSheet(
      context,
      title: 'Service photo',
      subtitle: 'Take a photo or pick one from your gallery',
    );
    if (source == null) return;
    final picked = await ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 1600);
    if (picked != null) {
      setState(() {
        _newPhoto = picked;
        _removeImage = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(lodgeServicesViewModelProvider);
    final isOther = _unit == null;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: AppTheme.s4,
        title: Row(
          children: [
            Container(
              width: 34,
              height: 34,
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
              child: Icon(
                _isEdit ? Icons.edit_rounded : Icons.room_service_rounded,
                color: Colors.white,
                size: 18,
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: Text(
                _isEdit ? 'Edit service' : 'Add service',
                overflow: TextOverflow.ellipsis,
                maxLines: 1,
              ),
            ),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(3),
          child: Container(
            height: 3,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [AppTheme.accent, Color(0x001457AD)],
              ),
            ),
          ),
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
                if (_error != null) ...[
                  _ErrorBanner(_error!),
                  const SizedBox(height: AppTheme.s12),
                ],

                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.elevated,
                  padding: const EdgeInsets.all(AppTheme.s16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SectionLabel('Details', number: 1, icon: Icons.room_service_rounded),
                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        key: _nameKey,
                        controller: _name,
                        label: 'Service name',
                        required: true,
                        errorText: _nameError,
                        hint: 'Private pool',
                        forceCapitalizeWords: true,
                        onChanged: (_) => setState(() {}),
                        dense: true,
                      ),
                      const SizedBox(height: AppTheme.s12),
                      Text('Photo (optional)', style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(height: AppTheme.s8),
                      _photoPicker(),

                      const SectionDivider(),
                      const SectionLabel('Pricing', number: 2, icon: Icons.payments_rounded),
                      const SizedBox(height: AppTheme.s12),
                      const Text(
                        'Price is what the guest pays, GST included. Past use keeps its old price.',
                        style: TextStyle(color: AppTheme.muted, fontSize: 11.5),
                      ),
                      const SizedBox(height: AppTheme.s12),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: NeuField(
                              key: _priceKey,
                              controller: _price,
                              label: 'Price',
                              required: true,
                              errorText: _priceError,
                              keyboardType: TextInputType.number,
                              onChanged: (_) => setState(() {}),
                              dense: true,
                            ),
                          ),
                          const SizedBox(width: AppTheme.s12),
                          Expanded(
                            child: NeuField(
                              controller: _gst,
                              label: 'GST %',
                              keyboardType: TextInputType.number,
                              dense: true,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppTheme.s12),
                      const RequiredLabel('Per'),
                      const SizedBox(height: AppTheme.s8),
                      KeyedSubtree(
                        key: _unitKey,
                        child: OptionDropdown(
                          values: [...kServiceUnitSuggestions, '__other'],
                          labels: {for (final u in kServiceUnitSuggestions) u: u, '__other': 'Other…'},
                          selected: isOther ? '__other' : _unit,
                          hasError: _unitError != null,
                          onSelect: (v) => setState(() => _unit = v == '__other' ? null : v),
                        ),
                      ),
                      if (isOther) ...[
                        const SizedBox(height: AppTheme.s8),
                        NeuField(
                          controller: _unitOther,
                          label: '',
                          hint: 'Type your own',
                          errorText: _unitError,
                          onChanged: (_) => setState(() {}),
                          dense: true,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s16),
                Row(
                  children: [
                    Expanded(
                      child: NeuButton(
                        onPressed: state.submitting ? null : () => Navigator.of(context).pop(),
                        padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                        child: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    Expanded(
                      flex: 2,
                      child: NeuButton(
                        primary: true,
                        onPressed: state.submitting ? null : _submit,
                        padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                        child: state.submitting
                            ? const SizedBox(
                                height: 16,
                                width: 16,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                              )
                            : const FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.save_rounded, color: Colors.white, size: 18),
                                    SizedBox(width: 4),
                                    Text('Save'),
                                  ],
                                ),
                              ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
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
