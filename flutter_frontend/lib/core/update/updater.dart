import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../../screens/theme.dart';

/// Windows self-update, same scheme as the Vittam billing app: every release
/// publishes `windows-latest.json` next to the installer, and
/// `releases/latest/download/` always redirects to the newest stable release.
/// Rolling out an update is just pushing a `v*` tag.
///   {"version":"1.2.3","url":"https://.../HotelManagerSetup.exe","force":false,
///    "message":"optional release note"}
const _manifestUrl =
    'https://github.com/CHSM-App/hotel_Management/releases/latest/download/windows-latest.json';

/// The app's own navigator, so the check can show a dialog from outside the tree.
final navigatorKey = GlobalKey<NavigatorState>();

class UpdateInfo {
  UpdateInfo(this.version, this.url, this.force, this.current, [this.message = '']);
  final String version, url, current, message;
  final bool force;
}

/// Parses "1.2.3" (a "v" prefix and "+build" are ignored) into [major, minor, patch].
List<int>? _ver(String s) {
  final p = s.trim().replaceFirst(RegExp(r'^[vV]'), '').split('+').first.split('.');
  if (p.length < 2 || p.length > 3) return null;
  final n = p.map(int.tryParse).toList();
  if (n.contains(null)) return null;
  return [...n.cast<int>(), if (n.length == 2) 0];
}

bool isNewer(String latest, String current) {
  final a = _ver(latest), b = _ver(current);
  if (a == null || b == null) return false;
  for (var i = 0; i < 3; i++) {
    if (a[i] != b[i]) return a[i] > b[i];
  }
  return false;
}

/// Pure half of [checkForUpdate] — anything malformed, missing or not actually
/// newer means "no update", never a prompt the user cannot satisfy.
UpdateInfo? parseManifest(Object? data, String current) {
  if (data is! Map) return null;
  final version = '${data['version'] ?? ''}', url = '${data['url'] ?? ''}';
  if (url.isEmpty || !isNewer(version, current)) return null;
  return UpdateInfo(version, url, data['force'] == true, current, '${data['message'] ?? ''}');
}

/// The newer release, or null — also null on ANY failure (offline, 404, bad
/// JSON): a desk that is offline must never see an error about updates.
Future<UpdateInfo?> checkForUpdate() async {
  if (!Platform.isWindows) return null;
  try {
    final res = await Dio().get<dynamic>(
      _manifestUrl,
      options: Options(
        responseType: ResponseType.json,
        receiveTimeout: const Duration(seconds: 10),
        sendTimeout: const Duration(seconds: 10),
      ),
    );
    return parseManifest(res.data, (await PackageInfo.fromPlatform()).version);
  } catch (_) {
    return null;
  }
}

/// Downloads the installer, runs it silently and quits so it can overwrite the
/// running files. Its [Run] entry has no skipifsilent, so it relaunches the app.
Future<void> _install(String url, void Function(double) onProgress) async {
  final file = File('${(await getTemporaryDirectory()).path}\\HotelManagerSetup.exe');
  // A half-written file from an earlier failed attempt must never be run.
  if (await file.exists()) await file.delete();
  await Dio().download(
    url,
    file.path,
    onReceiveProgress: (got, total) {
      if (total > 0) onProgress(got / total);
    },
  );
  if (await file.length() == 0) throw const FileSystemException('empty installer');
  // Detached: the installer must outlive the app it is about to replace.
  await Process.start(
    file.path,
    ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'],
    mode: ProcessStartMode.detached,
  );
  exit(0);
}

bool _dialogOpen = false;

/// Versions the desk already chose "Later" for — the background re-check must
/// not nag about the same release again until the app restarts.
final _dismissed = <String>{};

Future<void> _show(BuildContext ctx, UpdateInfo info) async {
  _dialogOpen = true;
  try {
    await showDialog<void>(
      context: ctx,
      barrierDismissible: !info.force,
      builder: (_) => _UpdateDialog(info),
    );
  } finally {
    _dialogOpen = false;
  }
}

/// Splash-screen gate. Checks for an update and, if there is one, shows the
/// dialog and waits for it. Returns false only when the update is forced — the
/// only way past that dialog is installing (which exits), so the caller must
/// not continue into the app.
Future<bool> runUpdateGate(BuildContext context) async {
  final info = await checkForUpdate();
  if (info == null || !context.mounted) return true;
  await _show(context, info);
  if (!info.force) _dismissed.add(info.version);
  return !info.force;
}

/// Shows the update dialog from anywhere (background re-check, "Check for
/// updates" button). [manual] = user pressed the button, so say so when there
/// is nothing new, and offer a version they previously postponed.
Future<void> promptForUpdate({bool manual = false}) async {
  // The overlay's context sits BELOW the Navigator. navigatorKey.currentContext
  // is the Navigator itself, and showDialog looks for one above it and throws.
  final ctx = navigatorKey.currentState?.overlay?.context;
  if (ctx == null || _dialogOpen) return;
  final info = await checkForUpdate();
  if (!ctx.mounted || _dialogOpen) return;
  if (info == null) {
    if (manual) {
      ScaffoldMessenger.maybeOf(ctx)?.showSnackBar(
        const SnackBar(content: Text('You are on the latest version.')),
      );
    }
    return;
  }
  if (!manual && !info.force && _dismissed.contains(info.version)) return;
  await _show(ctx, info);
  if (!info.force) _dismissed.add(info.version);
}

/// A desk can stay open for days, so look again every few hours instead of
/// only at launch. Call once, after the first frame.
Timer startPeriodicUpdateCheck() =>
    Timer.periodic(const Duration(hours: 6), (_) => promptForUpdate());

class _UpdateDialog extends StatefulWidget {
  const _UpdateDialog(this.info);
  final UpdateInfo info;
  @override
  State<_UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<_UpdateDialog> {
  double? _progress; // null = idle
  String? _error;

  Future<void> _start() async {
    setState(() {
      _progress = 0;
      _error = null;
    });
    try {
      await _install(widget.info.url, (p) {
        if (mounted) setState(() => _progress = p);
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _progress = null;
          _error = 'Download failed. Check your internet and try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final info = widget.info;
    final busy = _progress != null;
    final t = Theme.of(context).textTheme;
    return PopScope(
      canPop: !info.force && !busy,
      child: Dialog(
        backgroundColor: AppTheme.card,
        insetPadding: const EdgeInsets.all(24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppTheme.border),
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: AppTheme.sidebarBrandWash,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: AppTheme.sidebarBrandWashEdge),
                  ),
                  child: const Icon(Icons.system_update_alt_rounded,
                      size: 30, color: AppTheme.accent),
                ),
                const SizedBox(height: 16),
                Text('Update available',
                    style: t.titleLarge?.copyWith(
                        color: AppTheme.heading, fontWeight: FontWeight.w800)),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                  decoration: BoxDecoration(
                    color: AppTheme.focusWash,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: AppTheme.focusWashEdge),
                  ),
                  child: Text('v${info.current}  →  v${info.version}',
                      style: t.labelLarge?.copyWith(
                          color: AppTheme.link, fontWeight: FontWeight.w700)),
                ),
                const SizedBox(height: 14),
                Text(
                  info.message.isNotEmpty
                      ? info.message
                      : 'The app will restart to install it. Your data is kept.',
                  textAlign: TextAlign.center,
                  style: t.bodyMedium?.copyWith(color: AppTheme.text, height: 1.5),
                ),
                if (info.force) ...[
                  const SizedBox(height: 14),
                  _Note(
                    icon: Icons.info_outline_rounded,
                    text: 'This update is required to continue.',
                    bg: AppTheme.warningWash,
                    fg: AppTheme.warningInk,
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 14),
                  _Note(
                    icon: Icons.error_outline_rounded,
                    text: _error!,
                    bg: const Color(0xFFFDECEA),
                    fg: AppTheme.danger,
                  ),
                ],
                const SizedBox(height: 22),
                if (busy) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(
                      value: _progress,
                      minHeight: 8,
                      backgroundColor: AppTheme.border,
                      color: AppTheme.accent,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _progress! >= 1
                        ? 'Installing…'
                        : 'Downloading… ${(_progress! * 100).toStringAsFixed(0)}%',
                    style: t.bodySmall?.copyWith(color: AppTheme.muted),
                  ),
                ] else ...[
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _start,
                      icon: const Icon(Icons.download_rounded, size: 18),
                      label: Text(_error == null ? 'Update now' : 'Retry'),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppTheme.accent,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  SizedBox(
                    width: double.infinity,
                    child: info.force
                        ? TextButton(
                            onPressed: () => exit(0),
                            style: TextButton.styleFrom(foregroundColor: AppTheme.muted),
                            child: const Text('Quit'),
                          )
                        : TextButton(
                            onPressed: () => Navigator.pop(context),
                            style: TextButton.styleFrom(foregroundColor: AppTheme.muted),
                            child: const Text('Later'),
                          ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.icon, required this.text, required this.bg, required this.fg});
  final IconData icon;
  final String text;
  final Color bg, fg;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
        child: Row(children: [
          Icon(icon, size: 16, color: fg),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: fg, fontWeight: FontWeight.w600)),
          ),
        ]),
      );
}
