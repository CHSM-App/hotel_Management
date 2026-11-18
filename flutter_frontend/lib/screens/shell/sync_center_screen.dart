import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/offline/offline_controllers.dart';
import '../../core/offline/offline_store.dart';
import '../../presentation/providers/repository_provider.dart';
import '../theme.dart';

/// Everything this device did while it could not reach the server, and where
/// each thing stands. Most of the time it just says everything is saved; it
/// earns its place when something was held — a room that turned out to have
/// been sold twice, a bill the server priced differently — because those need a
/// person, and the desk has to be able to see them, retry them, or give them up.
class SyncCenterScreen extends ConsumerStatefulWidget {
  const SyncCenterScreen({super.key});

  @override
  ConsumerState<SyncCenterScreen> createState() => _SyncCenterScreenState();
}

class _SyncCenterScreenState extends ConsumerState<SyncCenterScreen> {
  List<OutboxOp> _ops = const [];
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final ops = await ref.read(offlineDeskProvider).store.ops();
    if (mounted) {
      setState(() {
        _ops = ops;
        _loaded = true;
      });
    }
  }

  Future<void> _syncNow() async {
    await ref.read(outboxDrainProvider).run();
    await _refresh();
  }

  Future<void> _retry(OutboxOp op) async {
    final drain = ref.read(outboxDrainProvider);
    await drain.retry(op);
    await drain.run();
    await _refresh();
  }

  Future<void> _discard(OutboxOp op) async {
    final isBooking = op.feature == 'booking.create';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Give this up?'),
        content: Text(
          isBooking
              ? 'The booking will be removed from this device and never sent to the '
                  'server, together with its check-in and bill. This cannot be undone.'
              : 'This will never be sent to the server. This cannot be undone.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep it')),
          TextButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Give it up', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await ref.read(outboxDrainProvider).discard(op);
    await _refresh();
  }

  static (String, Color) _statusOf(String status) => switch (status) {
    'pending' => ('Waiting to send', const Color(0xFFB45309)),
    'syncing' => ('Sending…', const Color(0xFF2563EB)),
    'conflict' => ('Needs your attention', const Color(0xFFEA580C)),
    'failed' => ('Could not be saved', AppTheme.danger),
    'blocked' => ('On hold', const Color(0xFF6B7280)),
    _ => (status, const Color(0xFF6B7280)),
  };

  @override
  Widget build(BuildContext context) {
    final busy = ref.watch(syncBusyProvider);
    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        title: const Text('Saved on this device'),
        actions: [
          IconButton(
            tooltip: 'Send now',
            onPressed: busy ? null : _syncNow,
            icon: busy
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.sync_rounded),
          ),
        ],
      ),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : _ops.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(AppTheme.s24),
                child: Text(
                  'Everything is saved on the server.\nNothing is waiting on this device.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppTheme.heading),
                ),
              ),
            )
          : RefreshIndicator(
              onRefresh: _refresh,
              child: ListView.separated(
                padding: const EdgeInsets.all(AppTheme.s12),
                itemCount: _ops.length,
                separatorBuilder: (_, _) => const SizedBox(height: AppTheme.s8),
                itemBuilder: (context, i) {
                  final op = _ops[i];
                  final (label, color) = _statusOf(op.status);
                  final held = op.status == 'conflict' || op.status == 'failed' || op.status == 'blocked';
                  return Container(
                    padding: const EdgeInsets.all(AppTheme.s12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(AppTheme.rMedium),
                      border: Border.all(color: color.withValues(alpha: 0.35)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                op.title,
                                style: const TextStyle(fontWeight: FontWeight.w700, color: AppTheme.heading),
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: color.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Text(
                                label,
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color),
                              ),
                            ),
                          ],
                        ),
                        if (op.lastError != null) ...[
                          const SizedBox(height: 6),
                          Text(op.lastError!, style: TextStyle(fontSize: 12, color: color)),
                        ],
                        if (op.feature == 'booking.settle' && op.meta['provisionalNumber'] != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Provisional bill ${op.meta['provisionalNumber']} · ₹${op.meta['offlineTotal']}',
                            style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
                          ),
                        ],
                        if (held) ...[
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              OutlinedButton(onPressed: () => _retry(op), child: const Text('Try again')),
                              const SizedBox(width: 8),
                              TextButton(
                                onPressed: () => _discard(op),
                                child: const Text('Give it up', style: TextStyle(color: AppTheme.danger)),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ),
    );
  }
}
