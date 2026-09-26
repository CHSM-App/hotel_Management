import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/constant.dart';
import '../../domain/models/asset.dart';
import '../../domain/models/expense.dart';
import '../../presentation/providers/usecase_provider.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../widgets/format.dart';
import '../../widgets/neu.dart';
import '../bookings/id_proof_viewer_screen.dart';
import '../bookings/receipt_download.dart';
import '../rooms/room_form_pieces.dart' show OptionDropdown, SectionLabel;
import '../theme.dart';
import 'asset_form_sheet.dart';
import 'asset_icons.dart';
import 'work_orders_panel.dart';

// Full option set for the payment-status dropdown — same reasoning as its
// twin in expense_form_screen.dart / asset_form_sheet.dart.
const _paymentStatusOptionLabel = {'PAID': 'Paid in full', 'PARTIAL': 'Partially paid', 'PENDING': 'Pending'};

/// The public deep link a scanned asset QR resolves to — mirrors assetUrl()
/// in lib/qr.js so the code printed here and the one the web app decodes
/// never drift apart. Opens a standalone page with just this asset's record,
/// no login and no dashboard chrome, straight off the scan.
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
                    style: Theme.of(context).textTheme.bodySmall,
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
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    // Tablets/landscape get the facts and QR side by side —
                    // on a phone-width column they'd otherwise leave the QR
                    // card floating in a lot of empty horizontal space.
                    final wide = constraints.maxWidth >= 640;
                    final hasQr = _asset!.qrToken != null;
                    return ListView(
                      padding: const EdgeInsets.fromLTRB(AppTheme.s16, AppTheme.s12, AppTheme.s16, AppTheme.s32),
                      children: [
                        _HeaderCard(asset: _asset!, onChanged: _load),
                        const SizedBox(height: AppTheme.s12),
                        if (wide && hasQr)
                          IntrinsicHeight(
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Expanded(flex: 3, child: _FactsCard(asset: _asset!)),
                                const SizedBox(width: AppTheme.s12),
                                Expanded(flex: 2, child: _QrCard(asset: _asset!)),
                              ],
                            ),
                          )
                        else ...[
                          _FactsCard(asset: _asset!),
                          if (hasQr) ...[
                            const SizedBox(height: AppTheme.s12),
                            _QrCard(asset: _asset!),
                          ],
                        ],
                        const SizedBox(height: AppTheme.s12),
                        _ActionsRow(asset: _asset!, onChanged: _load, onDelete: _deleteAsset),
                        if (_purchaseExpense != null) ...[
                          const SizedBox(height: AppTheme.s24),
                          _PurchasePaymentsSection(
                            expense: _purchaseExpense!,
                            payments: _purchasePayments,
                            onChanged: _loadPurchasePayments,
                          ),
                        ],
                        const SizedBox(height: AppTheme.s24),
                        _CoverageSection(asset: _asset!, coverage: _coverage, onChanged: _load),
                        const SizedBox(height: AppTheme.s24),
                        _ServiceHistorySection(asset: _asset!, workOrders: workOrders, onChanged: _load),
                      ],
                    );
                  },
                ),
              ),
      ),
    );
  }
}

Color _assetStatusColor(String status) => switch (status) {
  'IN_USE' => AppTheme.vacant,
  'UNDER_REPAIR' => AppTheme.draft,
  _ => AppTheme.muted,
};

IconData _assetStatusIcon(String status) => switch (status) {
  'IN_USE' => Icons.check_circle_rounded,
  'UNDER_REPAIR' => Icons.build_rounded,
  'TRANSFERRED' => Icons.swap_horiz_rounded,
  _ => Icons.remove_circle_rounded,
};

/// Identity + status in one card: a category icon badge tinted by status,
/// the asset's name/tag, and a colored status chip that opens the same
/// picker the old plain dropdown did — same data, one glance instead of two
/// separate cards to read top to bottom.
class _HeaderCard extends ConsumerWidget {
  final Asset asset;
  final VoidCallback onChanged;

  const _HeaderCard({required this.asset, required this.onChanged});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final color = _assetStatusColor(asset.status);
    return NeuCard(
      child: Row(
        children: [
          IconBadge(icon: categoryIcon(asset.categoryName), color: color, size: 46),
          const SizedBox(width: AppTheme.s12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  asset.name,
                  style: const TextStyle(color: AppTheme.heading, fontWeight: FontWeight.w700, fontSize: 16, letterSpacing: -0.2),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  [asset.assetTag, asset.categoryName].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
                  style: const TextStyle(color: AppTheme.muted, fontSize: 12.5),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.s8),
          PopupMenuButton<String>(
            tooltip: 'Change status',
            initialValue: asset.status,
            onSelected: (v) async {
              if (v == asset.status) return;
              final ok = await ref.read(assetsViewModelProvider.notifier).setStatus(asset.id, v);
              if (ok) onChanged();
            },
            offset: const Offset(0, 44),
            elevation: 6,
            color: AppTheme.card,
            surfaceTintColor: Colors.transparent,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.rMedium), side: const BorderSide(color: AppTheme.border)),
            itemBuilder: (context) => [
              for (final s in kAssetStatuses)
                PopupMenuItem(
                  value: s,
                  height: 40,
                  child: Row(
                    children: [
                      Icon(_assetStatusIcon(s), size: 16, color: _assetStatusColor(s)),
                      const SizedBox(width: AppTheme.s8),
                      Text(kAssetStatusLabel[s]!, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
            ],
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
              decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(_assetStatusIcon(asset.status), size: 14, color: color),
                  const SizedBox(width: 5),
                  Text(kAssetStatusLabel[asset.status] ?? asset.status, style: TextStyle(color: color, fontSize: 12.5, fontWeight: FontWeight.w700)),
                  const SizedBox(width: 2),
                  Icon(Icons.keyboard_arrow_down_rounded, size: 16, color: color),
                ],
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

    final rows = [
      _fact(Icons.location_on_outlined, 'Location', location.isEmpty ? 'Not set' : location),
      if (asset.brand.isNotEmpty || asset.model.isNotEmpty)
        _fact(Icons.precision_manufacturing_outlined, 'Brand / model', [asset.brand, asset.model].where((s) => s.isNotEmpty).join(' ')),
      if (asset.serialNumber.isNotEmpty) _fact(Icons.qr_code_2_rounded, 'Serial number', asset.serialNumber),
      if (asset.purchaseDate.isNotEmpty)
        _fact(
          Icons.calendar_month_outlined,
          'Purchased',
          [formatIsoDate(asset.purchaseDate), if (asset.purchaseCost != null) formatPrice(asset.purchaseCost)].join(' · '),
        ),
      _fact(Icons.verified_user_outlined, 'Warranty', asset.warrantyExpiry != null ? formatIsoDate(asset.warrantyExpiry!) : '—'),
      _fact(Icons.build_circle_outlined, 'AMC', asset.amcExpiry != null ? formatIsoDate(asset.amcExpiry!) : '—'),
      if (asset.vendorName != null) _fact(Icons.storefront_outlined, 'Vendor', asset.vendorName!),
      if (asset.locationNote.isNotEmpty) _fact(Icons.sticky_note_2_outlined, 'Note', asset.locationNote),
      _fact(
        Icons.receipt_long_outlined,
        'Purchase bill',
        null,
        valueWidget: asset.hasBillDocument
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
            : const Text('Not uploaded', style: TextStyle(color: AppTheme.muted, fontSize: 13)),
      ),
    ];

    return NeuCard(
      padding: const EdgeInsets.symmetric(vertical: AppTheme.s4, horizontal: AppTheme.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: AppTheme.border),
            rows[i],
          ],
        ],
      ),
    );
  }

  Widget _fact(IconData icon, String label, String? value, {Widget? valueWidget}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: AppTheme.s12),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 17, color: AppTheme.muted),
        const SizedBox(width: AppTheme.s12),
        SizedBox(width: 92, child: Text(label, style: const TextStyle(color: AppTheme.muted, fontSize: 12.5))),
        Expanded(child: valueWidget ?? Text(value ?? '', style: const TextStyle(color: AppTheme.text, fontSize: 13, fontWeight: FontWeight.w500))),
      ],
    ),
  );
}

/// "Scan to open this asset" — same deep link the web QR encodes. Download
/// builds a one-page PDF (name, tag, QR) and saves it straight to the
/// device via saveBytesToDevice — the same real-download path bill_pdf.dart
/// uses, not Printing.layoutPdf's print/share preview, which made "Download
/// QR" feel like it never actually downloaded anything.
class _QrCard extends StatelessWidget {
  final Asset asset;
  const _QrCard({required this.asset});

  Future<String> _download() async {
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
    final bytes = await doc.save();
    final safe = ((asset.assetTag ?? '').isNotEmpty ? asset.assetTag! : asset.name).replaceAll(RegExp(r'[\\/]'), '-');
    return saveBytesToDevice(bytes, '$safe-qr.pdf');
  }

  @override
  Widget build(BuildContext context) {
    final url = _assetUrl(asset.qrToken!);
    return NeuCard(
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(AppTheme.s12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
              border: Border.all(color: AppTheme.border),
            ),
            child: QrImageView(data: url, size: 128, backgroundColor: Colors.white),
          ),
          const SizedBox(height: AppTheme.s12),
          Text('Scan to open this asset', style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center),
          const SizedBox(height: AppTheme.s8),
          GestureDetector(
            onTap: () async {
              final messenger = ScaffoldMessenger.of(context);
              try {
                final where = await _download();
                messenger.showSnackBar(SnackBar(content: Text('Saved to $where'), backgroundColor: AppTheme.heading));
              } catch (_) {
                messenger.showSnackBar(const SnackBar(content: Text('Could not save the QR code.')));
              }
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: AppTheme.s12, vertical: AppTheme.s8),
              decoration: BoxDecoration(color: AppTheme.accent.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(999)),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.download_rounded, size: 15, color: AppTheme.accent),
                  SizedBox(width: 5),
                  Text('Download QR', style: TextStyle(color: AppTheme.accent, fontSize: 12.5, fontWeight: FontWeight.w700)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Report an issue / Add coverage / Edit asset / Delete asset — same order
/// as the web modal's action row: one full-width primary button for the
/// action taken most often, then the other three as a compact icon row so
/// the group reads as one unit instead of four same-weight buttons.
class _ActionsRow extends ConsumerWidget {
  final Asset asset;
  final VoidCallback onChanged;
  final VoidCallback onDelete;

  const _ActionsRow({required this.asset, required this.onChanged, required this.onDelete});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      children: [
        NeuButton(
          primary: true,
          expand: true,
          padding: const EdgeInsets.symmetric(vertical: AppTheme.s16),
          onPressed: () => showReportIssueDialog(context, assetId: asset.id),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.report_problem_rounded, size: 17, color: Colors.white),
              SizedBox(width: AppTheme.s8),
              Text('Report an issue'),
            ],
          ),
        ),
        const SizedBox(height: AppTheme.s8),
        Row(
          children: [
            Expanded(
              child: _SecondaryAction(
                icon: Icons.shield_outlined,
                label: 'Add coverage',
                onTap: () async {
                  final saved = await showCoverageForm(context, assetId: asset.id);
                  if (saved == true) onChanged();
                },
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: _SecondaryAction(
                icon: Icons.edit_outlined,
                label: 'Edit asset',
                onTap: () async {
                  await showAssetFormSheet(context, asset: asset);
                  onChanged();
                },
              ),
            ),
            const SizedBox(width: AppTheme.s8),
            Expanded(
              child: _SecondaryAction(
                icon: Icons.delete_outline_rounded,
                label: 'Delete',
                color: AppTheme.danger,
                onTap: onDelete,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _SecondaryAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;

  const _SecondaryAction({required this.icon, required this.label, required this.onTap, this.color = AppTheme.heading});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTheme.rMedium),
      child: Container(
        constraints: const BoxConstraints(minHeight: 60),
        padding: const EdgeInsets.symmetric(vertical: AppTheme.s8, horizontal: AppTheme.s4),
        decoration: BoxDecoration(
          color: AppTheme.card,
          borderRadius: BorderRadius.circular(AppTheme.rMedium),
          border: Border.all(color: color == AppTheme.danger ? AppTheme.danger.withValues(alpha: 0.3) : AppTheme.border),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 19, color: color),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
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
          style: Theme.of(context).textTheme.bodySmall,
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
                                  style: Theme.of(context).textTheme.titleSmall,
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
                  Text('Paid via', style: Theme.of(context).textTheme.bodySmall),
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
          Text(
            'No warranty or AMC on record yet. "Add coverage" logs the maker\'s warranty at purchase, '
            'then each AMC as it starts.',
            style: Theme.of(context).textTheme.bodySmall,
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
            Text(period.vendorName!, style: Theme.of(context).textTheme.titleSmall),
          ],
          if (period.cost != null) ...[
            const SizedBox(height: 4),
            Text('Cost: ${formatPrice(period.cost)}', style: Theme.of(context).textTheme.bodySmall),
          ],
          if (period.coverageNote.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text('Covers: ${period.coverageNote}', style: Theme.of(context).textTheme.bodySmall),
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
                  Text('Type', style: Theme.of(context).textTheme.bodySmall),
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
                  Text('Vendor (optional)', style: Theme.of(context).textTheme.bodySmall),
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
                  Text('Payment status', style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 4),
                  OptionDropdown(
                    values: kPaymentStatuses,
                    labels: _paymentStatusOptionLabel,
                    selected: _paymentStatus,
                    onSelect: (v) => setState(() => _paymentStatus = v),
                  ),
                  if (_paymentStatus != 'PENDING') ...[
                    const SizedBox(height: AppTheme.s12),
                    Text('Paid via', style: Theme.of(context).textTheme.bodySmall),
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
          Text('No work orders yet.', style: Theme.of(context).textTheme.bodySmall)
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
