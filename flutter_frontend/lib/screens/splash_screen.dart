import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/update/updater.dart';
import 'theme.dart';

/// Windows launch screen. Holds briefly while it looks for a newer release,
/// shows the update dialog if there is one, then hands over to [next].
///
/// A forced update never reaches [next]: the dialog's only ways out are
/// installing (the app exits) or Quit.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, required this.next});
  final WidgetBuilder next;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  String _status = 'Checking for updates…';
  String _version = '';

  @override
  void initState() {
    super.initState();
    _run();
  }

  Future<void> _run() async {
    PackageInfo.fromPlatform().then((i) {
      if (mounted) setState(() => _version = 'v${i.version}');
    });

    // Never let the check itself hold the desk hostage: checkForUpdate has its
    // own 10 s network timeout, and any failure counts as "no update".
    final minHold = Future<void>.delayed(const Duration(milliseconds: 1200));
    var proceed = true;
    try {
      proceed = await runUpdateGate(context);
    } catch (_) {}
    await minHold;
    if (!mounted || !proceed) return;

    setState(() => _status = 'Starting…');
    Navigator.of(context).pushReplacement(
      PageRouteBuilder<void>(
        pageBuilder: (c, _, __) => widget.next(c),
        transitionsBuilder: (_, a, __, child) => FadeTransition(opacity: a, child: child),
        transitionDuration: const Duration(milliseconds: 250),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppTheme.sidebarBrandInk, AppTheme.navbar, AppTheme.brandLift],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              const Spacer(flex: 3),
              Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: AppTheme.cardShadow,
                ),
                child: const Icon(Icons.apartment_rounded, size: 52, color: AppTheme.navbar),
              ),
              const SizedBox(height: 24),
              Text('Hotel Manager',
                  style: t.headlineMedium?.copyWith(
                      color: Colors.white, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
              const SizedBox(height: 6),
              Text('Front desk',
                  style: t.bodyMedium?.copyWith(color: Colors.white70, letterSpacing: 0.4)),
              const Spacer(flex: 3),
              SizedBox(
                width: 220,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: const LinearProgressIndicator(
                    minHeight: 3,
                    backgroundColor: Colors.white24,
                    color: AppTheme.cta,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(_status, style: t.bodySmall?.copyWith(color: Colors.white70)),
              const SizedBox(height: 4),
              Text(_version, style: t.bodySmall?.copyWith(color: Colors.white38)),
              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }
}
