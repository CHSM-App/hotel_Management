import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/neu.dart';
import '../../widgets/pill_tabs.dart';
import '../theme.dart';
import 'price_simulator_panel.dart';
import 'saved_quotations_panel.dart';

/// The Quotations page body — price a stay, keep it until check-in, turn it
/// into a booking. Not a sidebar section: it is a secondary page of the Room
/// Chart, opened full-screen by its Quotation button via [QuotationScreen].
///
/// Two tabs: price a new one (the simulator) and the quotations already saved.
/// The panel reads rooms and extras from [roomsViewModelProvider], which only
/// Rooms & rates used to load, so this loads them itself.
class QuotationsBody extends ConsumerStatefulWidget {
  const QuotationsBody({super.key});

  @override
  ConsumerState<QuotationsBody> createState() => _QuotationsBodyState();
}

class _QuotationsBodyState extends ConsumerState<QuotationsBody> {
  String _tab = 'new';
  // A new key on each switch to Saved so it reloads and shows what was just kept.
  int _savedGen = 0;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(roomsViewModelProvider.notifier).loadAll());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(roomsViewModelProvider);
    final empty = state.rooms.isEmpty && state.categories.isEmpty;

    if (state.isLoading && empty) return const Center(child: CircularProgressIndicator());
    if (state.error != null && empty) {
      return NeuNotice(
        icon: Icons.cloud_off_rounded,
        message: state.error!,
        action: NeuButton(
          onPressed: () => ref.read(roomsViewModelProvider.notifier).loadAll(),
          child: const Text('Try again'),
        ),
      );
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s4),
          child: PillTabs(
            selected: _tab,
            onSelect: (t) => setState(() {
              if (t == 'saved') _savedGen++;
              _tab = t;
            }),
            tabs: const [
              PillTab('new', 'New quotation', Icons.calculate_rounded),
              PillTab('saved', 'Saved', Icons.bookmarks_rounded),
            ],
          ),
        ),
        Expanded(
          child: _tab == 'new'
              ? PriceSimulatorPanel(onSaved: () => setState(() {
                  _savedGen++;
                  _tab = 'saved';
                }))
              : SavedQuotationsPanel(key: ValueKey(_savedGen)),
        ),
      ],
    );
  }
}

/// [QuotationsBody] pushed as a full screen with a back arrow — what the Room
/// Chart toolbar's Quotation button opens.
class QuotationScreen extends StatelessWidget {
  const QuotationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: const Text('Quotations'),
        backgroundColor: AppTheme.card,
        foregroundColor: AppTheme.heading,
        elevation: 0,
        scrolledUnderElevation: 0,
        shape: const Border(bottom: BorderSide(color: AppTheme.sidebarBorder)),
      ),
      body: const QuotationsBody(),
    );
  }
}
