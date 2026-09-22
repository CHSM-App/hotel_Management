import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/event_booking.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// Events & functions > Setup — mirrors the Setup tab's two CatalogueCards
/// in Events.jsx: Venues and Add-ons, each a list with inline activate /
/// deactivate and an add/edit dialog. Venue photos are left to the web
/// Setup tab, which already carries the multi-image picker the room form
/// uses — this phone screen covers the fields a function is actually
/// priced and booked on.
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
                    Text(hint, style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
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
    child: Text(message, style: const TextStyle(color: AppTheme.muted, fontSize: 13)),
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
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12),
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
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12),
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
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _capacity.dispose();
    _charge.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Enter a name for the venue.');
      return;
    }
    final ok = await ref.read(eventsViewModelProvider.notifier).saveVenue(
      id: widget.venue?.id,
      name: _name.text.trim(),
      capacityPax: int.tryParse(_capacity.text.trim()),
      baseCharge: num.tryParse(_charge.text.trim()) ?? 0,
    );
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
              Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              const SizedBox(height: AppTheme.s8),
            ],
            NeuField(controller: _name, label: 'Name', hint: 'Lotus Lawn', required: true),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _capacity, label: 'Capacity (optional)', hint: '200', keyboardType: TextInputType.number),
            const SizedBox(height: AppTheme.s8),
            NeuField(controller: _charge, label: 'Hire charge', hint: '25000', keyboardType: TextInputType.number),
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
              Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
              const SizedBox(height: AppTheme.s8),
            ],
            NeuField(controller: _name, label: 'Name', hint: 'DJ', required: true),
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
