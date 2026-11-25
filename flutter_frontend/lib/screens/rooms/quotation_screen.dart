import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';
import 'event_quote_panel.dart';
import 'menu_quote_panel.dart';
import 'price_simulator_panel.dart';
import 'quote_common.dart';
import 'saved_quotations_panel.dart';

/// The Quotations page body — price a stay, keep it until check-in, turn it
/// into a booking. Not a sidebar section: it is a secondary page of the Room
/// Chart, opened full-screen by its Quotation button via [QuotationScreen].
///
/// Two tabs: price a new one (the simulator) and the quotations already saved.
/// The panel reads rooms and extras from [roomsViewModelProvider], which only
/// Rooms & rates used to load, so this loads them itself.
class QuotationsBody extends ConsumerStatefulWidget {
  /// ROOM, EVENT, FOOD or BAR to lock the page to one kind (what an Events,
  /// Restaurant or Bar screen opens); null shows every kind the login may
  /// quote (what the Room Chart opens).
  final String? kind;

  const QuotationsBody({super.key, this.kind});

  @override
  ConsumerState<QuotationsBody> createState() => _QuotationsBodyState();
}

/// The list of saved quotations is the home; "New quotation" steps into a
/// create view (choose a kind, fill the form) and a save drops back to the
/// list with the new quotation at the top.
class _QuotationsBodyState extends ConsumerState<QuotationsBody> {
  bool _creating = false;
  String? _pickedKind;
  // A new key after each save so the list reloads and shows what was just kept.
  int _savedGen = 0;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(roomsViewModelProvider.notifier).loadAll());
  }

  List<String> get _kinds {
    if (widget.kind != null) return [widget.kind!];
    final user = ref.read(authViewModelProvider).me?.user;
    final kinds = quotableKinds((p) => user?.can(p) ?? false);
    return kinds.isEmpty ? ['ROOM'] : kinds;
  }

  String get _kind => _kinds.contains(_pickedKind) ? _pickedKind! : _kinds.first;

  Widget _newPanel(String kind, VoidCallback onSaved) => switch (kind) {
    'EVENT' => EventQuotePanel(onSaved: onSaved),
    'FOOD' || 'BAR' => MenuQuotePanel(key: ValueKey(kind), kind: kind, onSaved: onSaved),
    _ => PriceSimulatorPanel(onSaved: onSaved),
  };

  void _saved() => setState(() {
    _savedGen++;
    _creating = false;
  });

  @override
  Widget build(BuildContext context) {
    final kinds = _kinds;
    if (!_creating) {
      return SavedQuotationsPanel(
        key: ValueKey('$_savedGen-${widget.kind ?? 'all'}'),
        kind: widget.kind,
        kinds: kinds,
        onNew: () => setState(() => _creating = true),
      );
    }

    final kind = _kind;
    final state = ref.watch(roomsViewModelProvider);
    final empty = state.rooms.isEmpty && state.categories.isEmpty;
    Widget form;
    if (kind == 'ROOM' && state.isLoading && empty) {
      form = const Center(child: CircularProgressIndicator());
    } else if (kind == 'ROOM' && state.error != null && empty) {
      form = NeuNotice(
        icon: Icons.cloud_off_rounded,
        message: state.error!,
        action: NeuButton(onPressed: () => ref.read(roomsViewModelProvider.notifier).loadAll(), child: const Text('Try again')),
      );
    } else {
      form = _newPanel(kind, _saved);
    }

    return Column(
      children: [
        // Create header: a way back to the list, and what is being made.
        Container(
          decoration: const BoxDecoration(color: AppTheme.card, border: Border(bottom: BorderSide(color: AppTheme.sidebarBorder))),
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s8, vertical: AppTheme.s4),
          child: Row(
            children: [
              TextButton.icon(
                onPressed: () => setState(() => _creating = false),
                icon: const Icon(Icons.arrow_back_rounded, size: 18),
                label: const Text('Quotations'),
                style: TextButton.styleFrom(foregroundColor: AppTheme.accent, minimumSize: const Size(44, 44)),
              ),
              const Text('New quotation', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: AppTheme.heading)),
            ],
          ),
        ),
        if (widget.kind == null && kinds.length > 1)
          Padding(
            padding: EdgeInsets.fromLTRB(AppTheme.gutter(context), AppTheme.s12, AppTheme.gutter(context), 0),
            child: Align(
              alignment: Alignment.centerLeft,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 640),
                child: Row(
                  children: [
                    for (final (key, label, icon) in kQuotationKinds)
                      if (kinds.contains(key))
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(right: AppTheme.s8),
                            child: _KindTile(
                              label: label,
                              icon: icon,
                              color: SavedQuotationsPanelState.kindColor(key),
                              selected: kind == key,
                              onTap: () => setState(() => _pickedKind = key),
                            ),
                          ),
                        ),
                  ],
                ),
              ),
            ),
          ),
        Expanded(child: form),
      ],
    );
  }
}

/// One of the four "what are you quoting" choices at the top of the create view.
class _KindTile extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final bool selected;
  final VoidCallback onTap;

  const _KindTile({required this.label, required this.icon, required this.color, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.rMedium),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          constraints: const BoxConstraints(minHeight: 64),
          padding: const EdgeInsets.symmetric(vertical: AppTheme.s8, horizontal: AppTheme.s8),
          decoration: BoxDecoration(
            color: selected ? AppTheme.sidebarBrand : AppTheme.card,
            borderRadius: BorderRadius.circular(AppTheme.rMedium),
            border: Border.all(color: selected ? AppTheme.sidebarBrand : AppTheme.border, width: 1.2),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 22, color: selected ? Colors.white : color),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: selected ? Colors.white : AppTheme.heading),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// [QuotationsBody] pushed as a full screen with a back arrow — what the Room
/// Chart toolbar's Quotation button opens.
class QuotationScreen extends StatelessWidget {
  final String? kind;

  const QuotationScreen({super.key, this.kind});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: Text(kind == null ? 'Quotations' : '${quotationKindLabel(kind!)} quotations'),
        backgroundColor: AppTheme.card,
        foregroundColor: AppTheme.heading,
        elevation: 0,
        scrolledUnderElevation: 0,
        shape: const Border(bottom: BorderSide(color: AppTheme.sidebarBorder)),
      ),
      body: QuotationsBody(kind: kind),
    );
  }
}
