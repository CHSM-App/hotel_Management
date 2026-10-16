import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/models/lodge_service.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../rooms/room_form_pieces.dart';
import '../theme.dart';

/// Start a service — mirrors the 'useForm' modal in ServicesPanel.jsx: pick
/// a guest staying in-house, or type a walk-in's name.
///
/// Styled the same way as the New booking and Add room pages: a gradient
/// header icon, numbered sections with icon badges on one card, field-level
/// errors that only appear once Start has been tried, and a rate summary
/// pinned above Cancel/Start at the foot.
Future<void> showStartUsageScreen(BuildContext context, {ServiceUsage? editing}) {
  return Navigator.of(context).push(MaterialPageRoute(builder: (_) => StartUsageScreen(editing: editing)));
}

class StartUsageScreen extends ConsumerStatefulWidget {
  /// A still-open, unbilled use being corrected in place (PATCH) rather than started.
  final ServiceUsage? editing;

  const StartUsageScreen({super.key, this.editing});

  @override
  ConsumerState<StartUsageScreen> createState() => _StartUsageScreenState();
}

class _StartUsageScreenState extends ConsumerState<StartUsageScreen> {
  final _scrollController = ScrollController();

  // One key per required section, in the order the form asks them — so a
  // failed submit can jump straight to the first thing wrong instead of
  // leaving the desk to hunt for a red line it may not have noticed.
  final _serviceKey = GlobalKey();
  final _quantityKey = GlobalKey();
  final _guestKey = GlobalKey();
  final _headcountKey = GlobalKey();

  int? _serviceId;
  final _quantity = TextEditingController(text: '1');
  final _headcount = TextEditingController(text: '1');
  int? _bookingId;
  final _guestName = TextEditingController();
  final _guestPhone = TextEditingController();

  String? _error;

  /// Whether Start has been pressed at least once — a field that hasn't
  /// been submitted yet has nothing to be wrong about, so nothing turns red
  /// until the desk actually tries to save.
  bool _submitAttempted = false;

  String? get _serviceError {
    if (!_submitAttempted) return null;
    return _serviceId == null ? 'Choose a service.' : null;
  }

  String? get _quantityError {
    if (!_submitAttempted) return null;
    final qty = num.tryParse(_quantity.text.trim());
    return (qty == null || qty <= 0) ? 'Quantity must be more than 0.' : null;
  }

  String? get _headcountError {
    if (!_submitAttempted) return null;
    final n = int.tryParse(_headcount.text.trim());
    return (n == null || n < 1) ? 'Head count must be at least 1.' : null;
  }

  bool get _isEditing => widget.editing != null;

  @override
  void initState() {
    super.initState();
    final u = widget.editing;
    if (u != null) {
      _serviceId = u.serviceId;
      _quantity.text = '${u.quantity}';
      _headcount.text = '${u.headcount}';
      _bookingId = u.bookingId;
      _guestName.text = u.guestName ?? '';
      _guestPhone.text = u.guestPhone ?? '';
    }
  }

  String? get _guestError {
    if (!_submitAttempted || _bookingId != null) return null;
    return _guestName.text.trim().isEmpty ? "Enter the walk-in's name, or pick a staying guest." : null;
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _quantity.dispose();
    _headcount.dispose();
    _guestName.dispose();
    _guestPhone.dispose();
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
    if (_serviceError != null) {
      _scrollToError(_serviceKey);
      return;
    }
    if (_quantityError != null) {
      _scrollToError(_quantityKey);
      return;
    }
    if (_headcountError != null) {
      _scrollToError(_headcountKey);
      return;
    }
    if (_guestError != null) {
      _scrollToError(_guestKey);
      return;
    }

    final qty = num.parse(_quantity.text.trim());
    final notifier = ref.read(lodgeServicesViewModelProvider.notifier);
    final body = {
      if (!_isEditing) 'serviceId': _serviceId,
      'quantity': qty,
      'headcount': int.parse(_headcount.text.trim()),
      'bookingId': _bookingId,
      'guestName': _bookingId == null ? _guestName.text.trim() : '',
      'guestPhone': _bookingId == null ? _guestPhone.text.trim() : '',
    };
    final ok = _isEditing
        ? await notifier.updateUsage(widget.editing!.id, body)
        : await notifier.startUsage(body);
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context);
    } else {
      setState(() => _error = ref.read(lodgeServicesViewModelProvider).error ?? 'Could not start this service.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(lodgeServicesViewModelProvider);
    final active = state.activeServices;
    final picked = active.where((s) => s.id == _serviceId).firstOrNull;
    final unitLabel = _isEditing ? widget.editing!.unitLabel : picked?.unitLabel;
    final unitPrice = _isEditing ? widget.editing!.unitPrice : picked?.price;
    final amount = unitPrice == null
        ? null
        : unitPrice * (num.tryParse(_quantity.text.trim()) ?? 0) * (int.tryParse(_headcount.text.trim()) ?? 0);

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
              child: const Icon(Icons.room_service_rounded, color: Colors.white, size: 18),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              child: Text(_isEditing ? 'Edit service use' : 'Start a service', overflow: TextOverflow.ellipsis, maxLines: 1),
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
                if (active.isEmpty) ...[
                  const _ErrorBanner('Add a service under "Services & prices" first.'),
                  const SizedBox(height: AppTheme.s12),
                ],

                NeuCard(
                  radius: AppTheme.rLarge,
                  shadow: AppTheme.elevated,
                  padding: const EdgeInsets.all(AppTheme.s16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SectionLabel('Service', number: 1, icon: Icons.room_service_rounded),
                      const SizedBox(height: AppTheme.s12),
                      const RequiredLabel('Service'),
                      const SizedBox(height: AppTheme.s8),
                      KeyedSubtree(
                        key: _serviceKey,
                        child: OptionDropdown(
                          values: active.map((s) => '${s.id}').toList(),
                          labels: {for (final s in active) '${s.id}': '${s.name} — ${formatPrice(s.price)} per ${s.unitLabel}'},
                          selected: _serviceId?.toString(),
                          hasError: _serviceError != null,
                          onSelect: (v) {
                            if (!_isEditing) setState(() => _serviceId = int.parse(v));
                          },
                          hint: 'Choose…',
                        ),
                      ),
                      if (_serviceError != null) ...[
                        const SizedBox(height: AppTheme.s4),
                        Text(_serviceError!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                      ],
                      const SizedBox(height: AppTheme.s12),
                      NeuField(
                        key: _quantityKey,
                        controller: _quantity,
                        label: unitLabel != null ? 'Quantity ($unitLabel)' : 'Quantity',
                        required: true,
                        errorText: _quantityError,
                        keyboardType: TextInputType.number,
                        onChanged: (_) => setState(() {}),
                        dense: true,
                      ),
const SizedBox(height: AppTheme.s12),                      NeuField(                        key: _headcountKey,                        controller: _headcount,                        label: 'Head count',                        required: true,                        errorText: _headcountError,                        keyboardType: TextInputType.number,                        onChanged: (_) => setState(() {}),                        dense: true,                      ),

                      const SectionDivider(),
                      const SectionLabel('Guest', number: 2, icon: Icons.person_rounded),
                      const SizedBox(height: AppTheme.s12),
                      const Text(
                        "Pick a guest staying in-house, or type a walk-in's name.",
                        style: TextStyle(color: AppTheme.muted, fontSize: 11.5),
                      ),
                      const SizedBox(height: AppTheme.s8),
                      KeyedSubtree(
                        key: _guestKey,
                        child: OptionDropdown(
                          values: state.inHouseGuests.map((g) => '${g.bookingId}').toList(),
                          labels: {for (final g in state.inHouseGuests) '${g.bookingId}': 'Room ${g.roomNumber} · ${g.guestName}'},
                          selected: _bookingId?.toString(),
                          onSelect: (v) => setState(() => _bookingId = int.parse(v)),
                          hint: 'Walk-in / not staying',
                        ),
                      ),
                      if (_bookingId != null)
                        Align(
                          alignment: Alignment.centerLeft,
                          child: TextButton(
                            onPressed: () => setState(() => _bookingId = null),
                            child: const Text('Walk-in / not staying instead'),
                          ),
                        ),
                      if (_bookingId == null) ...[
                        const SizedBox(height: AppTheme.s12),
                        NeuField(
                          controller: _guestName,
                          label: 'Name',
                          required: true,
                          errorText: _guestError,
                          forceCapitalizeWords: true,
                          onChanged: (_) => setState(() {}),
                          dense: true,
                        ),
                        const SizedBox(height: AppTheme.s12),
                        NeuField(
                          controller: _guestPhone,
                          label: 'Phone',
                          keyboardType: TextInputType.phone,
                          dense: true,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.s16),
                _Footer(
                  amount: amount,
                  isEditing: _isEditing,
                  submitting: state.submitting,
                  onCancel: () => Navigator.of(context).pop(),
                  onSubmit: _submit,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── Footer ───────────────────────────────────────────────────────────────────

/// The amount this usage will carry, pinned above Cancel/Start — the same
/// "stays visible while the form is filled in" treatment the Add room
/// screen's own rate summary gets.
class _Footer extends StatelessWidget {
  final num? amount;
  final bool isEditing;
  final bool submitting;
  final VoidCallback onCancel;
  final VoidCallback onSubmit;

  const _Footer({
    required this.amount,
    this.isEditing = false,
    required this.submitting,
    required this.onCancel,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (amount != null) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
            decoration: BoxDecoration(
              color: AppTheme.accent.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(AppTheme.rMedium),
              border: Border.all(color: AppTheme.accent.withValues(alpha: 0.18)),
            ),
            child: Row(
              children: [
                Container(
                  width: 26,
                  height: 26,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppTheme.accent.withValues(alpha: 0.14),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.payments_rounded, color: AppTheme.accent, size: 14),
                ),
                const SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Text(
                    'Amount',
                    style: TextStyle(color: AppTheme.muted, fontSize: 11.5, fontWeight: FontWeight.w500),
                  ),
                ),
                Text(
                  formatPrice(amount!),
                  style: const TextStyle(
                    color: AppTheme.accent,
                    fontWeight: FontWeight.w800,
                    fontSize: 17,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppTheme.s12),
        ],
        Row(
          children: [
            Expanded(
              child: NeuButton(
                onPressed: submitting ? null : onCancel,
                padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                child: const Text('Cancel'),
              ),
            ),
            const SizedBox(width: AppTheme.s12),
            Expanded(
              flex: 2,
              child: NeuButton(
                primary: true,
                onPressed: submitting ? null : onSubmit,
                padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
                child: submitting
                    ? const SizedBox(
                        height: 16,
                        width: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 18),
                            const SizedBox(width: 4),
                            Text(isEditing ? 'Save' : 'Start'),
                          ],
                        ),
                      ),
              ),
            ),
          ],
        ),
      ],
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
