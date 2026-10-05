import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/invoice.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../widgets/neu.dart';
import '../theme.dart';

/// Bill numbering — GET/PATCH /billing/series, the same screen
/// BillNumberingPanel.jsx is: two series, each counting up on its own,
/// neither ever reusing a number already printed.
class NumberingScreen extends ConsumerStatefulWidget {
  const NumberingScreen({super.key});

  @override
  ConsumerState<NumberingScreen> createState() => _NumberingScreenState();
}

class _NumberingScreenState extends ConsumerState<NumberingScreen> {
  Map<String, BillSeries>? _series;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final series = await ref.read(billingUsecaseProvider).billingSeries();
      if (!mounted) return;
      setState(() {
        _series = series;
        _error = null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Could not load the numbering settings.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final series = _series;
    if (_error != null && series == null) {
      return NeuNotice(
        icon: Icons.cloud_off_rounded,
        message: _error!,
        action: NeuButton(onPressed: _load, child: const Text('Try again')),
      );
    }
    if (series == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppTheme.maxContentWidth),
        child: RefreshIndicator(
          onRefresh: _load,
          color: AppTheme.accent,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(AppTheme.s12, AppTheme.s8, AppTheme.s12, AppTheme.s24),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              NeuCard(
                radius: AppTheme.rLarge,
                padding: const EdgeInsets.all(AppTheme.s12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Bill numbering',
                      style: TextStyle(
                        color: AppTheme.heading,
                        fontWeight: FontWeight.w700,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      'Bills and advance receipts are numbered separately, each '
                      'counting up on its own. Numbers already printed are never '
                      'changed — this only sets where the next one continues from.',
                      style: TextStyle(color: AppTheme.muted, fontSize: 11.5, height: 1.35),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s12),
              _SeriesCard(
                key: ValueKey('final-${series['final']!.nextNumber}'),
                icon: Icons.receipt_long_rounded,
                title: 'Bills',
                note: 'The bill a guest is given at checkout.',
                series: series['final']!,
                onSaved: (updated) =>
                    setState(() => _series = {...series, 'final': updated}),
                save: (next) =>
                    ref.read(billingUsecaseProvider).updateBillingSeries('FINAL', next),
              ),
              const SizedBox(height: AppTheme.s12),
              _SeriesCard(
                key: ValueKey('advance-${series['advance']!.nextNumber}'),
                icon: Icons.payments_rounded,
                title: 'Advance receipts',
                note: 'The receipt for money taken when a booking is made.',
                series: series['advance']!,
                onSaved: (updated) =>
                    setState(() => _series = {...series, 'advance': updated}),
                save: (next) => ref
                    .read(billingUsecaseProvider)
                    .updateBillingSeries('ADVANCE', next),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SeriesCard extends StatefulWidget {
  final IconData icon;
  final String title;
  final String note;
  final BillSeries series;
  final ValueChanged<BillSeries> onSaved;
  final Future<BillSeries> Function(int nextNumber) save;

  const _SeriesCard({
    super.key,
    required this.icon,
    required this.title,
    required this.note,
    required this.series,
    required this.onSaved,
    required this.save,
  });

  @override
  State<_SeriesCard> createState() => _SeriesCardState();
}

class _SeriesCardState extends State<_SeriesCard> {
  late final _controller = TextEditingController(
    text: '${widget.series.nextNumber}',
  );
  bool _saving = false;
  bool _saved = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// What is already spent, said plainly — same three cases
  /// BillNumberingPanel.jsx's own `hint` covers. A property whose history is
  /// entirely under the old prefixed numbering has documents but no
  /// plain-integer floor, so "nothing issued yet" would be false.
  String get _hint {
    final s = widget.series;
    if (s.highestIssued > 0) {
      return 'Already issued up to ${s.highestIssued}, so this must be '
          '${s.minimumAllowed} or higher.';
    }
    if (s.issuedCount > 0) {
      return '${s.issuedCount} already issued under the old prefixed '
          'numbering — those keep the numbers they were printed with. '
          'Choose where the new plain numbering should start.';
    }
    return 'Nothing has been issued yet, so you can start anywhere.';
  }

  Future<void> _save() async {
    final parsed = int.tryParse(_controller.text.trim());
    if (parsed == null || parsed < 1) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final updated = await widget.save(parsed);
      if (!mounted) return;
      widget.onSaved(updated);
      setState(() => _saved = true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Could not save the number.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final parsed = int.tryParse(_controller.text.trim());
    final isWhole = parsed != null && parsed >= 1;
    final tooLow = isWhole && parsed < widget.series.minimumAllowed;
    final unchanged = isWhole && parsed == widget.series.nextNumber;

    return NeuCard(
      radius: AppTheme.rLarge,
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppTheme.accent, Color(0xFF434FC1)],
                  ),
                  borderRadius: BorderRadius.circular(AppTheme.rSmall),
                  boxShadow: const [
                    BoxShadow(color: Color(0x2A5A67D8), offset: Offset(0, 2), blurRadius: 5),
                  ],
                ),
                child: Icon(widget.icon, size: 14, color: Colors.white),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Text(
                  widget.title,
                  style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 14),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppTheme.s8),
          Text(widget.note, style: const TextStyle(color: AppTheme.muted, fontSize: 11.5, height: 1.4)),
          const SizedBox(height: AppTheme.s12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: AppTheme.sidebarBrandWash,
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
              border: Border.all(color: AppTheme.sidebarBrandWashEdge),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'NEXT ONE WILL BE',
                  style: TextStyle(
                    color: AppTheme.sidebarBrandInk,
                    fontWeight: FontWeight.w700,
                    fontSize: 10,
                    letterSpacing: 0.4,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  widget.series.nextDocumentNumber,
                  style: const TextStyle(
                    color: AppTheme.heading,
                    fontWeight: FontWeight.w700,
                    fontSize: 15.5,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppTheme.s12),
          NeuField(
            controller: _controller,
            label: 'Start numbering from',
            keyboardType: TextInputType.number,
            dense: true,
            onChanged: (_) => setState(() {
              _saved = false;
              _error = null;
            }),
          ),
          const SizedBox(height: AppTheme.s4),
          Text(_hint, style: const TextStyle(color: AppTheme.muted, fontSize: 10.5, height: 1.3)),
          if (tooLow) ...[
            const SizedBox(height: AppTheme.s4),
            Text(
              'Number $parsed has already been used. Start from '
              '${widget.series.minimumAllowed} or higher so no bill carries '
              'a number twice.',
              style: const TextStyle(color: AppTheme.danger, fontSize: 12),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: AppTheme.s4),
            Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
          ],
          const SizedBox(height: AppTheme.s12),
          Row(
            children: [
              if (_saved && _error == null) ...[
                const Icon(Icons.check_circle_rounded, color: AppTheme.vacant, size: 16),
                const SizedBox(width: 4),
                const Text(
                  'Saved',
                  style: TextStyle(color: AppTheme.vacant, fontWeight: FontWeight.w600, fontSize: 12.5),
                ),
                const Spacer(),
              ] else
                const Spacer(),
              SizedBox(
                width: 140,
                child: NeuButton(
                  primary: true,
                  onPressed: (_saving || !isWhole || tooLow || unchanged) ? null : _save,
                  padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                  child: Text(_saving ? 'Saving…' : 'Save'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
