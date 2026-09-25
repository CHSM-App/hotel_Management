import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/constant.dart';
import '../../domain/models/asset.dart';
import '../../domain/models/expense.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../bookings/id_proof_viewer_screen.dart';
import '../rooms/room_form_pieces.dart' show OptionDropdown, SectionLabel;
import '../theme.dart';
import 'asset_form_sheet.dart';
import 'work_orders_panel.dart';

// Full option set for the payment-status dropdown — same reasoning as its
// twin in expense_form_screen.dart / asset_form_sheet.dart.
const _paymentStatusOptionLabel = {'PAID': 'Paid in full', 'PARTIAL': 'Partially paid', 'PENDING': 'Pending'};

/// The staff-only deep link a scanned asset QR resolves to — mirrors
/// assetUrl() in lib/qr.js so the code printed here and the one the web app
/// decodes never drift apart. Opens a standalone page with just this asset's
/// record, not the full dashboard.
String _assetUrl(String qrToken) => '$baseUrl/asset/$qrToken';

/// One asset's full record — mirrors the "Asset detail" modal in
/// AssetsPanel.jsx: identity + status up top with its QR code beside it,
/// then Report an issue / Add coverage / Edit asset / ⋮ Delete, then
/// coverage history and service history below.
class AssetDetailScreen extends ConsumerStatefulWidget {
  final int assetId;
  const AssetDetailScreen({super.key, required this.assetId});

  @override
  ConsumerState<AssetDetailScreen> createState() => _AssetDetailScreenState();
}

class _AssetDetailScreenState extends ConsumerState<AssetDetailScreen> {
  Asset? _asset;
  List<CoveragePeriod> _coverage = const [];
  bool _loading = true;

  // The expense the asset's own purchase cost auto-generated — mirrors
  // purchaseExpense/visiblePurchasePayments in AssetsPanel.jsx. null payments
  // means "loading", not "none yet".
  Expense? _purchaseExpense;
  List<ExpensePayment>? _purchasePayments;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final vm = ref.read(assetsViewModelProvider.notifier);
    final results = await Future.wait([vm.fetchAsset(widget.assetId), vm.coverage(widget.assetId)]);
    if (!mounted) return;
    setState(() {
      _asset = results[0] as Asset?;
      _coverage = results[1] as List<CoveragePeriod>;
      _loading = false;
    });
    await _loadPurchasePayments();
  }

  Future<void> _loadPurchasePayments() async {
    final usecase = ref.read(expensesUsecaseProvider);
    List<Expense> expenses;
    try {
      expenses = await usecase.expenses(assetId: widget.assetId);
    } catch (_) {
      expenses = const [];
    }
    final purchase = expenses.where((e) => e.title.startsWith('Asset purchase:')).firstOrNull;
    if (!mounted) return;
    setState(() {
      _purchaseExpense = purchase;
      _purchasePayments = null;
    });
    if (purchase == null) return;
    List<ExpensePayment> payments;
    try {
      payments = await usecase.expensePayments(purchase.id);
    } catch (_) {
      payments = const [];
    }
    if (!mounted || _purchaseExpense?.id != purchase.id) return;
    setState(() => _purchasePayments = payments);
  }

  Future<void> _deleteAsset() async {
    final asset = _asset;
    if (asset == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Delete asset?', style: TextStyle(color: AppTheme.heading)),
        content: Text(
          'Delete "${asset.name}"? Its service history is kept, but it won\'t show in the register.',
          style: const TextStyle(color: AppTheme.text),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final ok = await ref.read(assetsViewModelProvider.notifier).deleteAsset(asset.id);
    if (ok && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final workOrders = ref
        .watch(assetsViewModelProvider)
        .workOrders
        .where((w) => w.assetId == widget.assetId)
        .toList()
      ..sort((a, b) => b.openedAt.compareTo(a.openedAt));

    return Scaffold(
      appBar: AppBar(
        title: _asset == null
            ? const Text('Asset')
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_asset!.name, overflow: TextOverflow.ellipsis),
                  Text(
                    [_asset!.assetTag, _asset!.categoryName].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w400),
                  ),
                ],
              ),
      ),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _asset == null
            ? const Center(child: Text('Asset not found.', style: TextStyle(color: AppTheme.muted)))
            : RefreshIndicator(
                onRefresh: _load,
                color: AppTheme.accent,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
                  children: [
                    _StatusCard(asset: _asset!, onChanged: _load),
                    const SizedBox(height: AppTheme.s12),
                    _FactsCard(asset: _asset!),
                    if (_asset!.qrToken != null) ...[
                      const SizedBox(height: AppTheme.s12),
                      _QrCard(asset: _asset!),
                    ],
                    const SizedBox(height: AppTheme.s12),
                    _ActionsRow(asset: _asset!, onChanged: _load, onDelete: _deleteAsset),
                    if (_purchaseExpense != null) ...[
                      const SizedBox(height: AppTheme.s16),
                      _PurchasePaymentsSection(
                        expense: _purchaseExpense!,
                        payments: _purchasePayments,
                        onChanged: _loadPurchasePayments,
                      ),
                    ],
                    const SizedBox(height: AppTheme.s16),
                    _CoverageSection(asset: _asset!, coverage: _coverage, onChanged: _load),
                    const SizedBox(height: AppTheme.s16),
                    _ServiceHistorySection(asset: _asset!, workOrders: workOrders, onChanged: _load),
                  ],
                ),
              ),
      ),
    );
  }
}

/// Status — a dropdown rather than chips, same control the web detail modal
/// uses: this is the one field on the whole screen someone changes often
/// enough that a single tap-and-pick beats a picker sheet.
class _StatusCard extends ConsumerWidget {
  final Asset asset;
  final VoidCallback onChanged;

  const _StatusCard({required this.asset, required this.onChanged});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return NeuCard(
      child: Row(
        children: [
          const Text('Status', style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: NeuPressed(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: asset.status,
                  dropdownColor: AppTheme.card,
                  items: [
                    for (final s in kAssetStatuses)
                      DropdownMenuItem(value: s, child: Text(kAssetStatusLabel[s]!, style: const TextStyle(fontSize: 13.5))),
                  ],
                  onChanged: (v) async {
                    if (v == null || v == asset.status) return;
                    final ok = await ref.read(assetsViewModelProvider.notifier).setStatus(asset.id, v);
                    if (ok) onChanged();
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FactsCard extends ConsumerWidget {
  final Asset asset;
  const _FactsCard({required this.asset});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = asset.roomNumber != null
        ? 'Room ${asset.roomNumber}'
        : [if (asset.floor.isNotEmpty) 'Floor ${asset.floor}', asset.department].where((s) => s.isNotEmpty).join(' · ');

    return NeuCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _fact('Location', location.isEmpty ? 'Not set' : location),
          if (asset.brand.isNotEmpty || asset.model.isNotEmpty)
            _fact('Brand / model', [asset.brand, asset.model].where((s) => s.isNotEmpty).join(' ')),
          if (asset.serialNumber.isNotEmpty) _fact('Serial number', asset.serialNumber),
          if (asset.purchaseDate.isNotEmpty)
            _fact(
              'Purchased',
              [formatIsoDate(asset.purchaseDate), if (asset.purchaseCost != null) formatPrice(asset.purchaseCost)].join(' · '),
            ),
          _fact('Warranty', asset.warrantyExpiry != null ? formatIsoDate(asset.warrantyExpiry!) : '—'),
          _fact('AMC', asset.amcExpiry != null ? formatIsoDate(asset.amcExpiry!) : '—'),
          if (asset.vendorName != null) _fact('Vendor', asset.vendorName!),
          if (asset.locationNote.isNotEmpty) _fact('Note', asset.locationNote),
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(width: 110, child: Text('Purchase bill', style: TextStyle(color: AppTheme.muted, fontSize: 12.5))),
                Expanded(
                  child: asset.hasBillDocument
                      ? GestureDetector(
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => IdProofViewerScreen(
                                title: 'Bill · ${asset.name}',
                                load: () async {
                                  final res = await ref.read(assetsViewModelProvider.notifier).usecase.assetBill(asset.id);
                                  return (Uint8List.fromList(res.data!), res.headers.value('content-type'));
                                },
                              ),
                            ),
                          ),
                          child: const Text('View bill', style: TextStyle(color: AppTheme.accent, fontSize: 13, fontWeight: FontWeight.w600)),
                        )
                      : const Text('Not uploaded', style: TextStyle(color: AppTheme.text, fontSize: 13)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _fact(String label, String value) => Padding(
    padding: const EdgeInsets.only(top: 6),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 110, child: Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 12.5))),
        Expanded(child: Text(value, style: const TextStyle(color: AppTheme.text, fontSize: 13))),
      ],
    ),
  );
}

/// "Scan to open this asset" — same deep link the web QR encodes. Download
/// builds a one-page PDF (name, tag, QR) and hands it to the OS print/share
/// sheet, the mobile equivalent of the web's browser download.
class _QrCard extends StatelessWidget {
  final Asset asset;
  const _QrCard({required this.asset});

  Future<void> _download() async {
    final url = _assetUrl(asset.qrToken!);
    final doc = pw.Document();
    doc.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a6,
        build: (_) => pw.Center(
          child: pw.Column(
            mainAxisAlignment: pw.MainAxisAlignment.center,
            children: [
              pw.BarcodeWidget(barcode: pw.Barcode.qrCode(), data: url, width: 160, height: 160),
              pw.SizedBox(height: 8),
              pw.Text(asset.name, style: pw.TextStyle(fontSize: 14, fontWeight: pw.FontWeight.bold), textAlign: pw.TextAlign.center),
              if (asset.assetTag != null) pw.Text(asset.assetTag!, style: const pw.TextStyle(fontSize: 10), textAlign: pw.TextAlign.center),
            ],
          ),
        ),
      ),
    );
    await Printing.layoutPdf(onLayout: (_) async => doc.save());
  }

  @override
  Widget build(BuildContext context) {
    final url = _assetUrl(asset.qrToken!);
    return NeuCard(
      child: Column(
        children: [
          QrImageView(data: url, size: 132, backgroundColor: Colors.white),
          const SizedBox(height: AppTheme.s8),
          const Text('Scan to open this asset', style: TextStyle(color: AppTheme.muted, fontSize: 12.5)),
          const SizedBox(height: 4),
          GestureDetector(
            onTap: _download,
            child: const Text('Download QR', style: TextStyle(color: AppTheme.accent, fontSize: 13, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

/// Report an issue / Add coverage / Edit asset / Delete asset — same order
/// as the web modal's action row, all as direct buttons.
class _ActionsRow extends ConsumerWidget {
  final Asset asset;
  final VoidCallback onChanged;
  final VoidCallback onDelete;

  const _ActionsRow({required this.asset, required this.onChanged, required this.onDelete});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Wrap(
      spacing: AppTheme.s8,
      runSpacing: AppTheme.s8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        NeuButton(
          primary: true,
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s12),
          onPressed: () => showReportIssueDialog(context, assetId: asset.id),
          child: const Text('Report an issue'),
        ),
        NeuButton(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s12),
          onPressed: () async {
            final saved = await showCoverageForm(context, assetId: asset.id);
            if (saved == true) onChanged();
          },
          child: const Text('Add coverage'),
        ),
        NeuButton(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s12),
          onPressed: () async {
            await showAssetFormSheet(context, asset: asset);
            onChanged();
          },
          child: const Text('Edit asset'),
        ),
        NeuButton(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.s16, vertical: AppTheme.s12),
          onPressed: onDelete,
          child: const Text('Delete asset', style: TextStyle(color: AppTheme.danger)),
        ),
      ],
    );
  }
}

/// "Purchase payments" — mirrors the purchaseExpense block in
/// AssetsPanel.jsx: the running total/remaining on the expense the asset's
/// purchase cost auto-generated, its payment list, and a mini add-payment
/// form, all reusing the same /expenses/:id/payments endpoints the Expenses
/// tab's own Payments section talks to.
class _PurchasePaymentsSection extends ConsumerStatefulWidget {
  final Expense expense;
  final List<ExpensePayment>? payments;
  final Future<void> Function() onChanged;

  const _PurchasePaymentsSection({required this.expense, required this.payments, required this.onChanged});

  @override
  ConsumerState<_PurchasePaymentsSection> createState() => _PurchasePaymentsSectionState();
}

class _PurchasePaymentsSectionState extends ConsumerState<_PurchasePaymentsSection> {
  final _amount = TextEditingController();
  String _method = 'CASH';
  late final _date = TextEditingController(text: _isoToday());
  final _reference = TextEditingController();
  bool _adding = false;
  String? _error;

  static String _isoToday() {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _amount.dispose();
    _date.dispose();
    _reference.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 1),
      initialDate: DateTime.tryParse(_date.text) ?? now,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      _date.text = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    });
  }

  Future<void> _add() async {
    setState(() => _error = null);
    final amount = num.tryParse(_amount.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount.');
      return;
    }
    if (_date.text.trim().isEmpty) {
      setState(() => _error = 'Enter when this was paid.');
      return;
    }
    setState(() => _adding = true);
    try {
      await ref.read(expensesUsecaseProvider).addExpensePayment(widget.expense.id, {
        'amount': amount.toString(),
        'paymentMethod': _method,
        'referenceNumber': _reference.text.trim(),
        'paidDate': _date.text.trim(),
      });
      _amount.clear();
      _reference.clear();
      _date.text = _isoToday();
      await widget.onChanged();
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not add that payment.');
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  Future<void> _delete(ExpensePayment payment) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.bg,
        title: const Text('Remove this payment?', style: TextStyle(color: AppTheme.heading)),
        content: Text('${formatPrice(payment.amount)} · ${kPaymentMethodLabel[payment.paymentMethod] ?? payment.paymentMethod}', style: const TextStyle(color: AppTheme.text)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Remove', style: TextStyle(color: AppTheme.danger))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(expensesUsecaseProvider).deleteExpensePayment(widget.expense.id, payment.id);
      await widget.onChanged();
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not remove that payment.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final amountPaid = widget.expense.amountPaid ?? 0;
    final total = widget.expense.amount;
    final remaining = total - amountPaid;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Purchase payments', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
        const SizedBox(height: 4),
        Text(
          '${formatPrice(amountPaid)} of ${formatPrice(total)} paid${remaining > 0.01 ? ' · ${formatPrice(remaining)} left' : ''}',
          style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
        ),
        const SizedBox(height: AppTheme.s8),
        if (widget.payments == null)
          const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
        else ...[
          if (widget.payments!.isNotEmpty)
            NeuCard(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                children: [
                  for (final p in widget.payments!)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: AppTheme.s4),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${formatPrice(p.amount)} · ${kPaymentMethodLabel[p.paymentMethod] ?? p.paymentMethod}',
                                  style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  [
                                    formatIsoDate(p.paidDate),
                                    if (p.referenceNumber != null && p.referenceNumber!.isNotEmpty)
                                      '${kPaymentReferenceLabel[p.paymentMethod] ?? 'Ref'}: ${p.referenceNumber}',
                                  ].join(' · '),
                                  style: const TextStyle(color: AppTheme.muted, fontSize: 11.5),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(Icons.delete_outline_rounded, size: 18, color: AppTheme.danger),
                            onPressed: () => _delete(p),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          if (_error != null) ...[
            const SizedBox(height: AppTheme.s8),
            Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
          ],
          if (remaining > 0.01) ...[
            const SizedBox(height: AppTheme.s12),
            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  NeuField(controller: _amount, label: 'Amount', keyboardType: TextInputType.number),
                  const SizedBox(height: AppTheme.s12),
                  const Text('Paid via', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: 4),
                  OptionDropdown(
                    values: kPaymentMethods,
                    labels: kPaymentMethodLabel,
                    selected: _method,
                    onSelect: (v) => setState(() => _method = v),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _date, label: 'Date', readOnly: true, onTap: _pickDate),
                  if (kPaymentReferenceLabel[_method] != null) ...[
                    const SizedBox(height: AppTheme.s12),
                    NeuField(controller: _reference, label: kPaymentReferenceLabel[_method]!),
                  ],
                  const SizedBox(height: AppTheme.s12),
                  NeuButton(
                    expand: true,
                    onPressed: _adding ? null : _add,
                    child: _adding
                        ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Add payment'),
                  ),
                ],
              ),
            ),
          ],
        ],
      ],
    );
  }
}

class _CoverageSection extends ConsumerWidget {
  final Asset asset;
  final List<CoveragePeriod> coverage;
  final VoidCallback onChanged;

  const _CoverageSection({required this.asset, required this.coverage, required this.onChanged});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sorted = [...coverage]..sort((a, b) => b.endDate.compareTo(a.endDate));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Coverage history', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
        const SizedBox(height: AppTheme.s8),
        if (sorted.isEmpty)
          const Text(
            'No warranty or AMC on record yet. "Add coverage" logs the maker\'s warranty at purchase, '
            'then each AMC as it starts.',
            style: TextStyle(color: AppTheme.muted, fontSize: 12.5),
          )
        else
          for (final period in sorted) ...[
            _CoverageCard(
              period: period,
              isLatestOfType: period.id == sorted.firstWhere((p) => p.coverageType == period.coverageType).id,
              onRenew: () async {
                final saved = await showCoverageForm(context, assetId: asset.id, renewFrom: period);
                if (saved == true) onChanged();
              },
              onDelete: () async {
                final confirmed = await showDialog<bool>(
                  context: context,
                  builder: (_) => AlertDialog(
                    backgroundColor: AppTheme.bg,
                    title: Text('Delete this ${period.coverageType == 'AMC' ? 'AMC' : 'warranty'} record?', style: const TextStyle(color: AppTheme.heading)),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                      TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete', style: TextStyle(color: AppTheme.danger))),
                    ],
                  ),
                );
                if (confirmed != true) return;
                final ok = await ref.read(assetsViewModelProvider.notifier).deleteCoverage(asset.id, period.id);
                if (ok) onChanged();
              },
            ),
            const SizedBox(height: AppTheme.s8),
          ],
      ],
    );
  }
}

class _CoverageCard extends StatelessWidget {
  final CoveragePeriod period;
  final bool isLatestOfType;
  final VoidCallback onRenew;
  final VoidCallback onDelete;

  const _CoverageCard({required this.period, required this.isLatestOfType, required this.onRenew, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      padding: const EdgeInsets.all(AppTheme.s12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: AppTheme.bg, borderRadius: BorderRadius.circular(999), border: Border.all(color: AppTheme.border)),
                child: Text(period.coverageType == 'AMC' ? 'AMC' : 'WARRANTY', style: const TextStyle(color: AppTheme.heading, fontSize: 10.5, fontWeight: FontWeight.w700)),
              ),
              const SizedBox(width: AppTheme.s8),
              Expanded(
                child: Text(
                  '${period.startDate != null ? '${formatIsoDate(period.startDate!)} – ' : 'Until '}${formatIsoDate(period.endDate)}',
                  style: const TextStyle(color: AppTheme.text, fontSize: 12.5),
                ),
              ),
              if (isLatestOfType)
                TextButton(
                  style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: Size.zero, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                  onPressed: onRenew,
                  child: const Text('Renew', style: TextStyle(fontSize: 12.5)),
                ),
              const SizedBox(width: AppTheme.s8),
              TextButton(
                style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: Size.zero, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                onPressed: onDelete,
                child: const Text('Delete', style: TextStyle(fontSize: 12.5, color: AppTheme.danger)),
              ),
            ],
          ),
          if (period.vendorName != null) ...[
            const SizedBox(height: 6),
            Text(period.vendorName!, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13)),
          ],
          if (period.cost != null) ...[
            const SizedBox(height: 4),
            Text('Cost: ${formatPrice(period.cost)}', style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
          ],
          if (period.coverageNote.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text('Covers: ${period.coverageNote}', style: const TextStyle(color: AppTheme.muted, fontSize: 12)),
          ],
        ],
      ),
    );
  }
}

/// Opens "Add coverage" (or "Renew coverage", when [renewFrom] is given) as
/// a full page rather than a dialog — same push pattern as
/// showAssetFormSheet, so it gets its own back gesture and full-height room
/// for the form instead of being squeezed into an AlertDialog. Resolves to
/// `true` once a period has been saved.
Future<bool?> showCoverageForm(BuildContext context, {required int assetId, CoveragePeriod? renewFrom}) {
  return Navigator.of(context).push<bool>(
    MaterialPageRoute(builder: (_) => _CoverageFormScreen(assetId: assetId, renewFrom: renewFrom)),
  );
}

class _CoverageFormScreen extends ConsumerStatefulWidget {
  final int assetId;
  final CoveragePeriod? renewFrom;
  const _CoverageFormScreen({required this.assetId, this.renewFrom});

  @override
  ConsumerState<_CoverageFormScreen> createState() => _CoverageFormScreenState();
}

class _CoverageFormScreenState extends ConsumerState<_CoverageFormScreen> {
  late String _type = widget.renewFrom?.coverageType ?? 'WARRANTY';
  late int? _vendorId = widget.renewFrom?.vendorId;
  late final _startDate = TextEditingController();
  late final _endDate = TextEditingController();
  late final _cost = TextEditingController();
  late final _note = TextEditingController();
  // Forwarded onto the expense a costed coverage period auto-generates —
  // never stored on the coverage row itself (see paymentMethodSchema in
  // assets.schema.js).
  String _paymentStatus = 'PAID';
  String _paymentMethod = 'CASH';
  final _amountPaid = TextEditingController();
  final _referenceNumber = TextEditingController();
  String? _error;
  bool _submitAttempted = false;

  String? get _endDateError =>
      (_submitAttempted && _endDate.text.trim().isEmpty) ? 'Enter when this coverage ends.' : null;

  final _endDateFieldKey = GlobalKey();

  @override
  void dispose() {
    _startDate.dispose();
    _endDate.dispose();
    _cost.dispose();
    _note.dispose();
    _amountPaid.dispose();
    _referenceNumber.dispose();
    super.dispose();
  }

  Future<void> _pickDate(TextEditingController controller) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 15),
      initialDate: now,
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.light(primary: AppTheme.accent, onPrimary: Colors.white, surface: AppTheme.bg, onSurface: AppTheme.heading),
        ),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      controller.text = '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    });
  }

  Future<void> _save() async {
    setState(() {
      _error = null;
      _submitAttempted = true;
    });
    if (_endDateError != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = _endDateFieldKey.currentContext;
        if (ctx != null) {
          Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 300), curve: Curves.easeOut, alignment: 0.15);
        }
      });
      return;
    }
    final ok = await ref.read(assetsViewModelProvider.notifier).addCoverage(widget.assetId, {
      'coverageType': _type,
      'vendorId': _vendorId,
      'startDate': _startDate.text.trim(),
      'endDate': _endDate.text.trim(),
      'cost': num.tryParse(_cost.text.trim()),
      'paymentMethod': _paymentMethod,
      'paymentStatus': _paymentStatus,
      'amountPaid': _paymentStatus == 'PARTIAL' ? _amountPaid.text.trim() : '',
      'referenceNumber': _paymentStatus != 'PENDING' ? _referenceNumber.text.trim() : '',
      'coverageNote': _note.text.trim(),
    });
    if (!mounted) return;
    if (ok) {
      Navigator.pop(context, true);
    } else {
      setState(() => _error = ref.read(assetsViewModelProvider).error ?? 'Could not add coverage.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(assetsViewModelProvider);
    return Scaffold(
      appBar: AppBar(title: Text(widget.renewFrom != null ? 'Renew coverage' : 'Add coverage')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s8, AppTheme.s16, AppTheme.s32),
          children: [
            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(AppTheme.s12),
                decoration: BoxDecoration(color: AppTheme.danger.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(AppTheme.rSmall)),
                child: Row(
                  children: [
                    const Icon(Icons.error_outline, color: AppTheme.danger, size: 18),
                    const SizedBox(width: AppTheme.s8),
                    Expanded(child: Text(_error!, style: const TextStyle(color: AppTheme.danger, fontSize: 13))),
                  ],
                ),
              ),
              const SizedBox(height: AppTheme.s16),
            ],

            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Coverage', number: 1),
                  const SizedBox(height: AppTheme.s12),
                  const Text('Type', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: 4),
                  NeuPressed(
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        isExpanded: true,
                        value: _type,
                        dropdownColor: AppTheme.card,
                        icon: const Icon(Icons.keyboard_arrow_down_rounded, color: AppTheme.muted),
                        items: const [
                          DropdownMenuItem(value: 'WARRANTY', child: Text('Warranty', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13.5))),
                          DropdownMenuItem(value: 'AMC', child: Text('AMC', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13.5))),
                        ],
                        onChanged: (v) => setState(() => _type = v!),
                      ),
                    ),
                  ),
                  const SizedBox(height: AppTheme.s12),
                  const Text('Vendor (optional)', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: 4),
                  NeuPressed(
                    padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<int?>(
                        isExpanded: true,
                        value: _vendorId,
                        dropdownColor: AppTheme.card,
                        icon: const Icon(Icons.keyboard_arrow_down_rounded, color: AppTheme.muted),
                        hint: const Text('No vendor', style: TextStyle(color: AppTheme.muted, fontSize: 13.5)),
                        items: [
                          const DropdownMenuItem(value: null, child: Text('No vendor', style: TextStyle(fontSize: 13.5))),
                          for (final v in state.activeVendors)
                            DropdownMenuItem(value: v.id, child: Text(v.name, style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w600, fontSize: 13.5))),
                        ],
                        onChanged: (v) => setState(() => _vendorId = v),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s16),

            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Period & cost', number: 2),
                  const SizedBox(height: AppTheme.s12),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: NeuField(controller: _startDate, label: 'Start date (optional)', hint: 'Tap to pick', readOnly: true, onTap: () => _pickDate(_startDate))),
                      const SizedBox(width: AppTheme.s8),
                      Expanded(
                        child: NeuField(
                          key: _endDateFieldKey,
                          controller: _endDate,
                          label: 'End date',
                          hint: 'Tap to pick',
                          readOnly: true,
                          onTap: () => _pickDate(_endDate),
                          required: true,
                          errorText: _endDateError,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _cost, label: 'Cost (optional)', keyboardType: TextInputType.number),
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s16),

            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Payment', number: 3),
                  const SizedBox(height: AppTheme.s12),
                  // Forwarded onto the expense a costed coverage period
                  // auto-generates — mirrors coverageForm.paymentStatus/
                  // paymentMethod/amountPaid/referenceNumber in AssetsPanel.jsx.
                  const Text('Payment status', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                  const SizedBox(height: 4),
                  OptionDropdown(
                    values: kPaymentStatuses,
                    labels: _paymentStatusOptionLabel,
                    selected: _paymentStatus,
                    onSelect: (v) => setState(() => _paymentStatus = v),
                  ),
                  if (_paymentStatus != 'PENDING') ...[
                    const SizedBox(height: AppTheme.s12),
                    const Text('Paid via', style: TextStyle(color: AppTheme.muted, fontSize: 12)),
                    const SizedBox(height: 4),
                    OptionDropdown(
                      values: kPaymentMethods,
                      labels: kPaymentMethodLabel,
                      selected: _paymentMethod,
                      onSelect: (v) => setState(() => _paymentMethod = v),
                    ),
                    if (kPaymentReferenceLabel[_paymentMethod] != null) ...[
                      const SizedBox(height: AppTheme.s12),
                      NeuField(controller: _referenceNumber, label: kPaymentReferenceLabel[_paymentMethod]!),
                    ],
                  ],
                  if (_paymentStatus == 'PARTIAL') ...[
                    const SizedBox(height: AppTheme.s12),
                    NeuField(controller: _amountPaid, label: 'Amount paid so far', keyboardType: TextInputType.number),
                  ],
                ],
              ),
            ),
            const SizedBox(height: AppTheme.s16),

            NeuCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SectionLabel('Notes', number: 4),
                  const SizedBox(height: AppTheme.s12),
                  NeuField(controller: _note, label: 'Coverage note (optional)', hint: 'What this covers'),
                ],
              ),
            ),

            const SizedBox(height: AppTheme.s24),
            NeuButton(
              primary: true,
              expand: true,
              onPressed: state.submitting ? null : _save,
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

class _ServiceHistorySection extends StatelessWidget {
  final Asset asset;
  final List<WorkOrder> workOrders;
  final VoidCallback onChanged;

  const _ServiceHistorySection({required this.asset, required this.workOrders, required this.onChanged});

  Color _statusColor(String status) => switch (status) {
    'OPEN' => AppTheme.danger,
    'IN_PROGRESS' => AppTheme.draft,
    _ => AppTheme.vacant,
  };

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Service history', style: TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 15)),
        const SizedBox(height: AppTheme.s8),
        if (workOrders.isEmpty)
          const Text('No work orders yet.', style: TextStyle(color: AppTheme.muted, fontSize: 12.5))
        else
          NeuCard(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Column(
              children: [
                for (final w in workOrders)
                  InkWell(
                    onTap: () => showWorkOrderDialog(context, workOrder: w),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: AppTheme.s4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            margin: const EdgeInsets.only(top: 3),
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(color: _statusColor(w.status).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
                            child: Text(kWorkOrderStatusLabel[w.status] ?? w.status, style: TextStyle(color: _statusColor(w.status), fontSize: 10.5, fontWeight: FontWeight.w700)),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Expanded(
                            child: Text(w.description, style: const TextStyle(color: AppTheme.text, fontSize: 13)),
                          ),
                          const SizedBox(width: AppTheme.s8),
                          Text(formatDateTime(w.openedAt), style: const TextStyle(color: AppTheme.muted, fontSize: 11.5)),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
