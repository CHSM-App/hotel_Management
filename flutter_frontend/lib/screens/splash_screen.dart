import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/update/updater.dart';
import 'theme.dart';

/// Launch screen on every platform. On Windows it holds while it looks for a
/// newer release and shows the update dialog if there is one; elsewhere
/// [runUpdateGate] finds nothing and it is just a brief branded hold.
///
/// A forced update never reaches [next]: the dialog's only ways out are
/// installing (the app exits) or Quit.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, required this.next});
  final WidgetBuilder next;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _anim =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..forward();
  late final Animation<double> _fade =
      CurvedAnimation(parent: _anim, curve: const Interval(0, .7, curve: Curves.easeOut));
  late final Animation<double> _rise = Tween<double>(begin: 24, end: 0).animate(_fade);

  String _status = 'Checking for updates…';
  String _version = '';

  @override
  void initState() {
    super.initState();
    _run();
  }

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  Future<void> _run() async {
    PackageInfo.fromPlatform().then((i) {
      if (mounted) setState(() => _version = 'Version ${i.version}');
    });

    // checkForUpdate has its own 10 s network timeout and treats any failure as
    // "no update", so the check can never hold the desk hostage.
    final minHold = Future<void>.delayed(const Duration(milliseconds: 1400));
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
        transitionDuration: const Duration(milliseconds: 300),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      backgroundColor: AppTheme.sidebarBrandInk,
      body: LayoutBuilder(builder: (context, c) {
        // Scale off the smaller side so a phone, a tall narrow window and a
        // maximised desktop all get proportionate type and logo.
        final short = c.biggest.shortestSide;
        final wide = c.maxWidth >= 800;
        final logo = (short * .22).clamp(72.0, 128.0);
        final title = (short * .075).clamp(26.0, 44.0);

        return Stack(children: [
          // Backdrop: navy gradient plus two soft rings for depth.
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [AppTheme.sidebarBrandInk, AppTheme.navbar, AppTheme.brandLift],
                ),
              ),
            ),
          ),
          Positioned(
            top: -short * .35,
            right: -short * .3,
            child: _Ring(size: short * 1.0, color: Colors.white.withValues(alpha: .05)),
          ),
          Positioned(
            bottom: -short * .45,
            left: -short * .35,
            child: _Ring(size: short * 1.2, color: AppTheme.cta.withValues(alpha: .07)),
          ),

          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: AnimatedBuilder(
                  animation: _anim,
                  builder: (_, child) => Opacity(
                    opacity: _fade.value,
                    child: Transform.translate(offset: Offset(0, _rise.value), child: child),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: logo,
                          height: logo,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(logo * .26),
                            boxShadow: const [
                              BoxShadow(
                                color: Color(0x55000000),
                                blurRadius: 40,
                                offset: Offset(0, 16),
                              ),
                            ],
                          ),
                          child: Icon(Icons.apartment_rounded,
                              size: logo * .55, color: AppTheme.navbar),
                        ),
                        SizedBox(height: logo * .28),
                        Text(
                          'Hotel Manager',
                          textAlign: TextAlign.center,
                          style: t.headlineMedium?.copyWith(
                            fontSize: title,
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -.8,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Rooms · Bookings · Billing',
                          textAlign: TextAlign.center,
                          style: t.bodyMedium?.copyWith(
                            color: Colors.white70,
                            letterSpacing: .6,
                          ),
                        ),
                        SizedBox(height: wide ? 56 : 44),
                        SizedBox(
                          width: wide ? 260 : 200,
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: const LinearProgressIndicator(
                              minHeight: 3,
                              backgroundColor: Colors.white24,
                              color: AppTheme.cta,
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                        AnimatedSwitcher(
                          duration: const Duration(milliseconds: 200),
                          child: Text(
                            _status,
                            key: ValueKey(_status),
                            style: t.bodySmall?.copyWith(color: Colors.white70),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),

          // Footer pinned to the bottom edge, clear of the home indicator.
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 20),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_version, style: t.bodySmall?.copyWith(color: Colors.white54)),
                  const SizedBox(height: 2),
                  Text('by VengurlaTech',
                      style: t.labelSmall?.copyWith(color: Colors.white38, letterSpacing: .5)),
                ]),
              ),
            ),
          ),
        ]);
      }),
    );
  }
}

class _Ring extends StatelessWidget {
  const _Ring({required this.size, required this.color});
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(shape: BoxShape.circle, color: color),
      );
}
