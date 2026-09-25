import 'dart:io';

import 'package:dio/dio.dart' as dio;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/constant.dart';
import '../../domain/models/event_booking.dart';
import '../../domain/models/room.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../../widgets/photo_source_sheet.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// The most photos a venue can carry — mirrors [maxRoomImages] and the
/// web's own MAX_VENUE_IMAGES.
const maxVenueImages = 6;

/// Events & functions > Setup — mirrors the Setup tab's two CatalogueCards
/// in Events.jsx: Venues and Add-ons, each a list with inline activate /
/// deactivate and an add/edit dialog, plus a venue's own photo picker
/// (same [AddPhotoTile]/[PhotoThumb] pieces and camera-or-gallery sheet the
/// room form uses).
class EventsSetupPanel extends ConsumerStatefulWidget {
  const EventsSetupPanel({super.key});

  @override
  ConsumerState<EventsSetupPanel> createState() => _EventsSetupPanelState();
}

class _EventsSetupPanelState extends ConsumerState<EventsSetupPanel> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(eventsViewModelProvider.notifier).loadCatalogue());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(eventsViewModelProvider);

    return RefreshIndicator(
      onRefresh: () => ref.read(eventsViewModelProvider.notifier).loadCatalogue(),
      color: AppTheme.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s4, AppTheme.s12, AppTheme.s24),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (state.catalogueLoading && state.venues.isEmpty && state.addons.isEmpty)
            const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
          else ...[
            _SectionCard(
              title: 'Venues',
              hint: 'Halls and lawns that can be booked for a function.',
              addLabel: 'Add a venue',
              onAdd: () => _editVenue(context, ref),
              children: [
                if (state.venues.isEmpty) const _Empty('Nothing set up yet.'),
                for (final v in state.venues) _VenueRow(venue: v, onEdit: () => _editVenue(context, ref, venue: v)),
              ],
            ),
            const SizedBox(height: AppTheme.s12),
            _SectionCard(
              title: 'Add-ons',
              hint: 'Extras quoted on top of venue and plates — DJ, decor, mandap.',
              addLabel: 'Add an add-on',
              onAdd: () => _editAddon(context, ref),
              children: [
                if (state.addons.isEmpty) const _Empty('Nothing set up yet.'),
                for (final a in state.addons) _AddonRow(addon: a, onEdit: () => _editAddon(context, ref, addon: a)),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _editVenue(BuildContext context, WidgetRef ref, {EventVenue? venue}) {
    return showDialog(
      context: context,
      builder: (_) => _VenueDialog(venue: venue),
    );
  }

  Future<void> _editAddon(BuildContext context, WidgetRef ref, {EventAddon? addon}) {
    return showDialog(
      context: context,
      builder: (_) => _AddonDialog(addon: addon),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final String hint;
  final String addLabel;
  final VoidCallback onAdd;
  final List<Widget> children;

  const _SectionCard({
    required this.title,
    required this.hint,
    required this.addLabel,
    required this.onAdd,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
                    Text(hint, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.add_circle_outline_rounded, color: AppTheme.accent),
                tooltip: addLabel,
                onPressed: onAdd,
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          ...children,
        ],
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  final String message;
  const _Empty(this.message);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: AppTheme.s8),
    child: Text(message, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.muted)),
  );
}

class _VenueRow extends ConsumerWidget {
  final EventVenue venue;
  final VoidCallback onEdit;

  const _VenueRow({required this.venue, required this.onEdit});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          if (venue.images.isNotEmpty) ...[
            Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Image.network(
                    '$baseUrl/venue-images/${venue.images.first.filename}',
                    width: 36,
                    height: 36,
                    fit: BoxFit.cover,
                  ),
                ),
                if (venue.images.length > 1)
                  Positioned(
                    right: 0,
                    bottom: 0,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 3),
                      decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(4)),
                      child: Text('+${venue.images.length - 1}', style: const TextStyle(color: Colors.white, fontSize: 9)),
                    ),
                  ),
              ],
            ),
            const SizedBox(width: AppTheme.s8),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        venue.name,
                        style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w500, fontSize: 13.5),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (!venue.isActive) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(6)),
                        child: const Text('inactive', style: TextStyle(color: AppTheme.muted, fontSize: 10)),
                      ),
                    ],
                  ],
                ),
                Text(
                  '${venue.capacityPax != null ? '${venue.capacityPax} pax · ' : ''}${formatPrice(venue.baseCharge)}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          TextButton(onPressed: onEdit, child: const Text('Edit')),
          TextButton(
            onPressed: () => ref.read(eventsViewModelProvider.notifier).toggleVenue(venue),
            child: Text(venue.isActive ? 'Deactivate' : 'Activate'),
          ),
        ],
      ),
    );
  }
}

class _AddonRow extends ConsumerWidget {
  final EventAddon addon;
  final VoidCallback onEdit;

  const _AddonRow({required this.addon, required this.onEdit});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        addon.name,
                        style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w500, fontSize: 13.5),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (!addon.isActive) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(6)),
                        child: const Text('inactive', style: TextStyle(color: AppTheme.muted, fontSize: 10)),
                      ),
                    ],
                  ],
                ),
                Text(
                  '${formatPrice(addon.defaultAmount)}${addon.isPerUnit ? ' each' : ''}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          TextButton(onPressed: onEdit, child: const Text('Edit')),
          TextButton(
            onPressed: () => ref.read(eventsViewModelProvider.notifier).toggleAddon(addon),
            child: Text(addon.isActive ? 'Deactivate' : 'Activate'),
          ),
        ],
      ),
    );
  }
}

// ── Add / edit dialogs ──────────────────────────────────────────────────────

class _VenueDialog extends ConsumerStatefulWidget {
  final EventVenue? venue;
  const _VenueDialog({this.venue});

  @override
  ConsumerState<_VenueDialog> createState() => _VenueDialogState();
}

class _VenueDialogState extends ConsumerState<_VenueDialog> {
  late final _name = TextEditingController(text: widget.venue?.name ?? '');
  late final _capacity = TextEditingController(text: widget.venue?.capacityPax?.toString() ?? '');
  late final _charge = TextEditingController(text: widget.venue?.baseCharge == null ? '' : widget.venue!.baseCharge.toString());
  late final List<RoomImage> _existingPhotos = List.of(widget.venue?.images ?? const []);
  final List<XFile> _newPhotos = [];
  String? _error;

  bool get _photosFull => _existingPhotos.length + _newPhotos.length >= maxVenueImages;

  @override
  void dispose() {
    _name.dispose();
    _capacity.dispose();
    _charge.dispose();
    super.dispose();
  }

  Future<void> _pickPhotos() async {
    final room = _existingPhotos.length + _newPhotos.length;
    final allowed = maxVenueImages - room;
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
    if (widget.venue == null) return;
    final vm = ref.read(eventsViewModelProvider.notifier);
    final ok = await vm.deleteVenueImage(widget.venue!.id, img.id);
    if (!mounted) return;
    if (ok) {
      setState(() => _existingPhotos.removeWhere((i) => i.id == img.id));
    } else {
      setState(() => _error = ref.read(eventsViewModelProvider).error ?? 'Could not delete this photo.');
    }
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a name for the venue.');
      return;
    }
    final formMap = <String, dynamic>{
      'name': _name.text.trim(),
      'capacityPax': _capacity.text.trim(),
      'baseCharge': (num.tryParse(_charge.text.trim()) ?? 0).toString(),
    };
    for (final file in _newPhotos) {
      formMap.update(
        'images',
        (existing) => [...(existing as List), dio.MultipartFile.fromFileSync(file.path, filename: file.name)],
        ifAbsent: () => [dio.MultipartFile.fromFileSync(file.path, filename: file.name)],
      );
    }
    final ok = await ref
        .read(eventsViewModelProvider.notifier)
        .saveVenue(dio.FormData.fromMap(formMap), id: widget.venue?.id);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(eventsViewModelProvider).error ?? 'Could not save the venue.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(eventsViewModelProvider).submitting;
    return AlertDialog(
      backgroundColor: AppTheme.bg,
      title: Text(widget.venue == null ? 'Add a venue' : 'Edit venue', style: const TextStyle(color: AppTheme.heading)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_error != null) ...[
              Text(_error!, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.danger)),
              const SizedBox(height: AppTheme.s8),
            ],
            NeuField(controller: _name, label: 'Name', hint: 'Lotus Lawn', required: true, forceCapitalizeWords: true),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _capacity, label: 'Capacity (optional)', hint: '200', keyboardType: TextInputType.number),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _charge, label: 'Hire charge', hint: '25000', keyboardType: TextInputType.number),
            const SizedBox(height: AppTheme.s12),
            Align(
              alignment: Alignment.centerLeft,
              child: Text('Photos (up to $maxVenueImages)', style: Theme.of(context).textTheme.bodySmall),
            ),
            const SizedBox(height: AppTheme.s8),
            Wrap(
              spacing: AppTheme.s8,
              runSpacing: AppTheme.s8,
              children: [
                for (final img in _existingPhotos)
                  PhotoThumb(
                    imageProvider: NetworkImage('$baseUrl/venue-images/${img.filename}'),
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
      actions: [
        TextButton(onPressed: submitting ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(onPressed: submitting ? null : _save, child: Text(submitting ? 'Saving…' : 'Save')),
      ],
    );
  }
}

class _AddonDialog extends ConsumerStatefulWidget {
  final EventAddon? addon;
  const _AddonDialog({this.addon});

  @override
  ConsumerState<_AddonDialog> createState() => _AddonDialogState();
}

class _AddonDialogState extends ConsumerState<_AddonDialog> {
  late final _name = TextEditingController(text: widget.addon?.name ?? '');
  late final _amount = TextEditingController(text: widget.addon?.defaultAmount == null ? '' : widget.addon!.defaultAmount.toString());
  late bool _perUnit = widget.addon?.isPerUnit ?? false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a name for the add-on.');
      return;
    }
    final ok = await ref.read(eventsViewModelProvider.notifier).saveAddon(
      id: widget.addon?.id,
      name: _name.text.trim(),
      defaultAmount: num.tryParse(_amount.text.trim()) ?? 0,
      isPerUnit: _perUnit,
    );
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(eventsViewModelProvider).error ?? 'Could not save the add-on.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final submitting = ref.watch(eventsViewModelProvider).submitting;
    return AlertDialog(
      backgroundColor: AppTheme.bg,
      title: Text(widget.addon == null ? 'Add an add-on' : 'Edit add-on', style: const TextStyle(color: AppTheme.heading)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_error != null) ...[
              Text(_error!, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.danger)),
              const SizedBox(height: AppTheme.s8),
            ],
            NeuField(controller: _name, label: 'Name', hint: 'DJ', required: true, forceCapitalizeWords: true),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _amount, label: 'Price', hint: '5000', keyboardType: TextInputType.number),
            const SizedBox(height: AppTheme.s8),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _perUnit,
              onChanged: (v) => setState(() => _perUnit = v ?? false),
              title: const Text('Per unit', style: TextStyle(color: AppTheme.text, fontSize: 13)),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: submitting ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(onPressed: submitting ? null : _save, child: Text(submitting ? 'Saving…' : 'Save')),
      ],
    );
  }
}
