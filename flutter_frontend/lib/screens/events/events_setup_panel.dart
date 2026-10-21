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
import '../../widgets/pill_tabs.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// The most photos a venue can carry — mirrors [maxRoomImages] and the
/// web's own MAX_VENUE_IMAGES.
const maxVenueImages = 6;

/// Events & functions > Setup — mirrors Events.jsx's own Setup tab: Venues
/// and Add-ons each get a sub-tab of their own (same subtabs switch the web
/// uses) rather than one long page of both, each a list with inline
/// activate/deactivate and an add/edit dialog, plus a venue's own photo
/// picker (same [AddPhotoTile]/[PhotoThumb] pieces and camera-or-gallery
/// sheet the room form uses).
class EventsSetupPanel extends ConsumerStatefulWidget {
  const EventsSetupPanel({super.key});

  @override
  ConsumerState<EventsSetupPanel> createState() => _EventsSetupPanelState();
}

class _EventsSetupPanelState extends ConsumerState<EventsSetupPanel> {
  String _tab = 'venues';

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(eventsViewModelProvider.notifier).loadCatalogue());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(eventsViewModelProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, 0),
          child: _SubTabs(selected: _tab, onSelect: (t) => setState(() => _tab = t)),
        ),
        Expanded(
          child: Stack(
            children: [
              RefreshIndicator(
                onRefresh: () => ref.read(eventsViewModelProvider.notifier).loadCatalogue(),
                color: AppTheme.accent,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s12, AppTheme.s12, AppTheme.s32 + 56),
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: [
                    if (state.catalogueLoading && state.venues.isEmpty && state.addons.isEmpty)
                      const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()))
                    else if (_tab == 'venues')
                      _SectionCard(
                        title: 'Venues',
                        hint: 'Halls and lawns that can be booked for a function.',
                        icon: Icons.villa_rounded,
                        children: [
                          if (state.venues.isEmpty) const _Empty('Nothing set up yet.'),
                          for (final v in state.venues)
                            _VenueRow(
                              venue: v,
                              onEdit: () => _editVenue(context, ref, venue: v),
                              onToggle: () => _confirmToggle(
                                context,
                                name: v.name,
                                active: v.isActive,
                                onConfirm: () => ref.read(eventsViewModelProvider.notifier).toggleVenue(v),
                              ),
                            ),
                        ],
                      )
                    else
                      _SectionCard(
                        title: 'Add-ons',
                        hint: 'Extras quoted on top of venue and plates — DJ, decor, mandap.',
                        icon: Icons.extension_rounded,
                        children: [
                          if (state.addons.isEmpty) const _Empty('Nothing set up yet.'),
                          for (final a in state.addons)
                            _AddonRow(
                              addon: a,
                              onEdit: () => _editAddon(context, ref, addon: a),
                              onToggle: () => _confirmToggle(
                                context,
                                name: a.name,
                                active: a.isActive,
                                onConfirm: () => ref.read(eventsViewModelProvider.notifier).toggleAddon(a),
                              ),
                            ),
                        ],
                      ),
                  ],
                ),
              ),
              Positioned(
                right: AppTheme.s16,
                bottom: AppTheme.s16,
                child: FloatingActionButton(
                  backgroundColor: AppTheme.accent,
                  foregroundColor: Colors.white,
                  tooltip: _tab == 'venues' ? 'Add a venue' : 'Add an add-on',
                  onPressed: () => _tab == 'venues' ? _editVenue(context, ref) : _editAddon(context, ref),
                  child: const Icon(Icons.add_rounded),
                ),
              ),
            ],
          ),
        ),
      ],
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

  /// Asks before flipping a venue/add-on's own availability — a slip of the
  /// thumb here pulls something out of (or back into) every future quote, so
  /// it gets the same "are you sure" the menu's own delete actions use.
  Future<void> _confirmToggle(
    BuildContext context, {
    required String name,
    required bool active,
    required VoidCallback onConfirm,
  }) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppTheme.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rLarge)),
        icon: Container(
          width: 44,
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: (active ? AppTheme.danger : AppTheme.vacant).withValues(alpha: 0.10),
            shape: BoxShape.circle,
          ),
          child: Icon(
            active ? Icons.power_settings_new_rounded : Icons.check_circle_outline_rounded,
            color: active ? AppTheme.danger : AppTheme.vacant,
          ),
        ),
        title: Text(
          active ? 'Deactivate "$name"?' : 'Activate "$name"?',
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppTheme.heading, fontSize: 15.5, fontWeight: FontWeight.w700),
        ),
        content: Text(
          active
              ? 'It will stop showing up as a pick for new functions, until it is activated again.'
              : 'It will be available as a pick for new functions again.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        actionsAlignment: MainAxisAlignment.center,
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              active ? 'Deactivate' : 'Activate',
              style: TextStyle(color: active ? AppTheme.danger : AppTheme.vacant, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
    if (sure == true) onConfirm();
  }
}

class _SubTabs extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onSelect;

  const _SubTabs({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return PillTabs(
      selected: selected,
      onSelect: onSelect,
      tabs: const [
        PillTab('venues', 'Venues', Icons.villa_rounded),
        PillTab('addons', 'Add-ons', Icons.extension_rounded),
      ],
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final String hint;
  final IconData icon;
  final List<Widget> children;

  const _SectionCard({
    required this.title,
    required this.hint,
    required this.icon,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      radius: AppTheme.rLarge,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.10), shape: BoxShape.circle),
                child: Icon(icon, size: 18, color: AppTheme.accent),
              ),
              const SizedBox(width: AppTheme.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15.5)),
                    const SizedBox(height: 1),
                    Text(hint, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s12),
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
    padding: const EdgeInsets.symmetric(vertical: AppTheme.s16),
    child: Center(
      child: Text(message, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppTheme.muted)),
    ),
  );
}

/// The small, round pencil / power-toggle pair every catalogue row ends
/// with — icon-only so a row stays compact on a phone-width screen instead
/// of two spelled-out [TextButton]s crowding the edge.
class _RowActions extends StatelessWidget {
  final bool active;
  final VoidCallback onEdit;
  final VoidCallback onToggle;

  const _RowActions({required this.active, required this.onEdit, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    Widget button(IconData icon, Color color, VoidCallback onTap, String tooltip) {
      return Tooltip(
        message: tooltip,
        child: InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.10), shape: BoxShape.circle),
            child: Icon(icon, size: 15, color: color),
          ),
        ),
      );
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        button(Icons.edit_outlined, AppTheme.accent, onEdit, 'Edit'),
        const SizedBox(width: 6),
        button(
          active ? Icons.power_settings_new_rounded : Icons.check_circle_outline_rounded,
          active ? AppTheme.danger : AppTheme.vacant,
          onToggle,
          active ? 'Deactivate' : 'Activate',
        ),
      ],
    );
  }
}

class _VenueRow extends StatelessWidget {
  final EventVenue venue;
  final VoidCallback onEdit;
  final VoidCallback onToggle;

  const _VenueRow({required this.venue, required this.onEdit, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    final inactive = !venue.isActive;
    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      padding: const EdgeInsets.all(AppTheme.s8),
      decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(AppTheme.rMedium)),
      child: Row(
        children: [
          if (venue.images.isNotEmpty) ...[
            Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(AppTheme.rSmall),
                  child: Image.network(
                    '$baseUrl/venue-images/${venue.images.first.filename}',
                    width: 44,
                    height: 44,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      width: 44,
                      height: 44,
                      color: AppTheme.card,
                      alignment: Alignment.center,
                      child: const Icon(Icons.villa_rounded, size: 18, color: AppTheme.muted),
                    ),
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
            const SizedBox(width: AppTheme.s12),
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
                          style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13.5),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (inactive) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                          decoration: BoxDecoration(color: AppTheme.card, borderRadius: BorderRadius.circular(6)),
                          child: const Text('inactive', style: TextStyle(color: AppTheme.muted, fontSize: 9.5, fontWeight: FontWeight.w600)),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      if (venue.capacityPax != null) ...[
                        Text('${venue.capacityPax} pax', style: Theme.of(context).textTheme.bodySmall),
                        const SizedBox(width: 8),
                      ],
                      Text(
                        formatPrice(venue.baseCharge),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.heading, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          const SizedBox(width: AppTheme.s8),
          _RowActions(active: venue.isActive, onEdit: onEdit, onToggle: onToggle),
        ],
      ),
    );
  }
}

class _AddonRow extends StatelessWidget {
  final EventAddon addon;
  final VoidCallback onEdit;
  final VoidCallback onToggle;

  const _AddonRow({required this.addon, required this.onEdit, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    final inactive = !addon.isActive;
    return Container(
      margin: const EdgeInsets.only(bottom: AppTheme.s8),
      padding: const EdgeInsets.all(AppTheme.s8),
      decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(AppTheme.rMedium)),
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
                        style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13.5),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (inactive) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                        decoration: BoxDecoration(color: AppTheme.card, borderRadius: BorderRadius.circular(6)),
                        child: const Text('inactive', style: TextStyle(color: AppTheme.muted, fontSize: 9.5, fontWeight: FontWeight.w600)),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '${formatPrice(addon.defaultAmount)}${addon.isPerUnit ? ' each' : ''}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppTheme.heading, fontWeight: FontWeight.w600),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          _RowActions(active: addon.isActive, onEdit: onEdit, onToggle: onToggle),
        ],
      ),
    );
  }
}

// ── Add / edit dialogs ──────────────────────────────────────────────────────
//
// A shared card shell — icon header with a close button, scrollable body,
// and a full-width Cancel/Save footer — so the venue and add-on dialogs read
// as one system instead of Material's plain [AlertDialog] banner.

class _DialogShell extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? error;
  final bool submitting;
  final String saveLabel;
  final VoidCallback onSave;
  final Widget child;

  const _DialogShell({
    required this.icon,
    required this.title,
    required this.error,
    required this.submitting,
    required this.saveLabel,
    required this.onSave,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Container(
          decoration: BoxDecoration(
            color: AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rLarge),
            boxShadow: AppTheme.elevated,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s16, AppTheme.s8, 0),
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
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
                      child: Icon(icon, size: 17, color: Colors.white),
                    ),
                    const SizedBox(width: AppTheme.s12),
                    Expanded(
                      child: Text(
                        title,
                        style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 16),
                      ),
                    ),
                    IconButton(
                      onPressed: submitting ? null : () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded, size: 19, color: AppTheme.muted),
                      splashRadius: 18,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s8),
              Container(
                height: 3,
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [AppTheme.accent, Color(0x001457AD)],
                  ),
                ),
              ),
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (error != null) ...[
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(AppTheme.s8),
                          decoration: BoxDecoration(
                            color: AppTheme.danger.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(AppTheme.rSmall),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.error_outline_rounded, size: 15, color: AppTheme.danger),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12.5)),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppTheme.s12),
                      ],
                      child,
                    ],
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s16),
                decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppTheme.border))),
                child: Row(
                  children: [
                    Expanded(
                      child: NeuButton(
                        onPressed: submitting ? null : () => Navigator.pop(context),
                        expand: true,
                        padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                        child: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(
                      child: NeuButton(
                        onPressed: submitting ? null : onSave,
                        primary: true,
                        expand: true,
                        padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                        child: Text(submitting ? 'Saving…' : saveLabel),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

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
    return _DialogShell(
      icon: Icons.villa_rounded,
      title: widget.venue == null ? 'Add a venue' : 'Edit venue',
      error: _error,
      submitting: submitting,
      saveLabel: 'Save',
      onSave: _save,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          NeuField(controller: _name, label: 'Name', hint: 'Lotus Lawn', required: true, forceCapitalizeWords: true, dense: true),
          const SizedBox(height: AppTheme.s8),
          NeuField(controller: _capacity, label: 'Capacity (optional)', hint: '200', keyboardType: TextInputType.number, dense: true),
          const SizedBox(height: AppTheme.s8),
          NeuField(controller: _charge, label: 'Hire charge', hint: '25000', keyboardType: TextInputType.number, dense: true),
          const SectionDivider(),
          Text(
            'PHOTOS (UP TO $maxVenueImages)',
            style: const TextStyle(color: AppTheme.muted, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0.4),
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
    return _DialogShell(
      icon: Icons.extension_rounded,
      title: widget.addon == null ? 'Add an add-on' : 'Edit add-on',
      error: _error,
      submitting: submitting,
      saveLabel: 'Save',
      onSave: _save,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          NeuField(controller: _name, label: 'Name', hint: 'DJ', labelColor: AppTheme.heading, labelWeight: FontWeight.w700, required: true, forceCapitalizeWords: true, dense: true),
          const SizedBox(height: AppTheme.s8),
          NeuField(controller: _amount, label: 'Price', hint: '5000', labelColor: AppTheme.heading, labelWeight: FontWeight.w700, keyboardType: TextInputType.number, dense: true),
          const SizedBox(height: AppTheme.s12),
          InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => setState(() => _perUnit = !_perUnit),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: _perUnit ? AppTheme.sidebarBrandWash : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: _perUnit ? AppTheme.accent : AppTheme.border2,
                  width: _perUnit ? 1.5 : 1,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.layers_rounded,
                    size: 20,
                    color: _perUnit ? AppTheme.accent : AppTheme.muted,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Per unit',
                          style: TextStyle(color: AppTheme.heading, fontSize: 13.5, fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Price is charged for each unit (chair, drink…)',
                          style: TextStyle(color: AppTheme.muted, fontSize: 11.5),
                        ),
                      ],
                    ),
                  ),
                  Switch.adaptive(
                    value: _perUnit,
                    activeTrackColor: AppTheme.accent,
                    onChanged: (v) => setState(() => _perUnit = v),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
