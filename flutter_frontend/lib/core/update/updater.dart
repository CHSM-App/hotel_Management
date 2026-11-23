import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

/// Windows self-update, same scheme as the Vittam billing app: every release
/// publishes `windows-latest.json` next to the installer, and
/// `releases/latest/download/` always redirects to the newest stable release.
/// Rolling out an update is just pushing a `v*` tag.
///   {"version":"1.2.3","url":"https://.../HotelManagerSetup.exe","force":false}
const _manifestUrl =
    'https://github.com/CHSM-App/hotel_Management/releases/latest/download/windows-latest.json';

/// The app's own navigator, so the check can show a dialog from outside the tree.
final navigatorKey = GlobalKey<NavigatorState>();

class UpdateInfo {
  UpdateInfo(this.version, this.url, this.force);
  final String version, url;
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
    final m = res.data as Map<String, dynamic>;
    final current = (await PackageInfo.fromPlatform()).version;
    final version = '${m['version'] ?? ''}', url = '${m['url'] ?? ''}';
    if (url.isEmpty || !isNewer(version, current)) return null;
    return UpdateInfo(version, url, m['force'] == true);
  } catch (_) {
    return null;
  }
}

/// Downloads the installer, runs it silently and quits so it can overwrite the
/// running files. Its [Run] entry has no skipifsilent, so it relaunches the app.
Future<void> _install(String url, void Function(double) onProgress) async {
  final file = File('${(await getTemporaryDirectory()).path}\\HotelManagerSetup.exe');
  await Dio().download(
    url,
    file.path,
    onReceiveProgress: (got, total) {
      if (total > 0) onProgress(got / total);
    },
  );
  // Detached: the installer must outlive the app it is about to replace.
  await Process.start(
    file.path,
    ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'],
    mode: ProcessStartMode.detached,
  );
  exit(0);
}

/// Shows the update dialog. [manual] = user pressed "Check for updates", so
/// say so when there is nothing new.
Future<void> promptForUpdate({bool manual = false}) async {
  final ctx = navigatorKey.currentContext;
  if (ctx == null) return;
  final info = await checkForUpdate();
  if (!ctx.mounted) return;
  if (info == null) {
    if (manual) {
      ScaffoldMessenger.maybeOf(ctx)?.showSnackBar(
        const SnackBar(content: Text('You are on the latest version.')),
      );
    }
    return;
  }
  await showDialog<void>(
    context: ctx,
    barrierDismissible: !info.force,
    builder: (_) => _UpdateDialog(info),
  );
}

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
    final busy = _progress != null;
    return PopScope(
      canPop: !widget.info.force && !busy,
      child: AlertDialog(
        title: const Text('Update available'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Version ${widget.info.version} is ready. The app will restart '
                'to install it; your data is kept.'),
            if (widget.info.force)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('This update is required to continue.'),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            if (busy) ...[
              const SizedBox(height: 16),
              LinearProgressIndicator(value: _progress),
              const SizedBox(height: 4),
              Text('${(_progress! * 100).toStringAsFixed(0)}%'),
            ],
          ],
        ),
        actions: busy
            ? null
            : [
                if (!widget.info.force)
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Later'),
                  ),
                FilledButton(onPressed: _start, child: const Text('Update now')),
              ],
      ),
    );
  }
}
