import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/network/token_provider.dart';
import 'screens/login_screen.dart';
import 'screens/shell/dashboard_shell.dart';
import 'screens/theme.dart';

/// Lets a screen know when it's been covered by a pushed route and later
/// uncovered again — the tape chart uses this to snap back to today the
/// moment the desk returns from booking a room or opening a stay, rather
/// than leaving it wherever a pushed screen found it.
final routeObserver = RouteObserver<ModalRoute<void>>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // The session is read off disk before the first frame, and the warmed
  // container is handed to the tree.
  //
  // The blueprint's version builds a throwaway ProviderContainer here and then
  // lets ProviderScope build its own, so the work is discarded and only appears
  // to have happened because the splash screen loads the session a second time
  // (§14.1). UncontrolledProviderScope is the fix, and it means there is no
  // second load and no frame of "signed out" before a signed-in user's shell.
  final container = ProviderContainer();
  await container.read(tokenProvider.notifier).loadSession();

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const FrontDeskApp(),
    ),
  );
}

class FrontDeskApp extends StatelessWidget {
  const FrontDeskApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Front desk',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      themeMode: ThemeMode.light,
      scrollBehavior: _AppScrollBehavior(),
      navigatorObservers: [routeObserver],
      home: const AuthGate(),
    );
  }
}

/// Lets a mouse drag scroll the same way a finger or a trackpad does.
///
/// Flutter's own default leaves the mouse out of `dragDevices` — a plain
/// click-and-drag on a scroll view does nothing with it, only the wheel
/// does. That is invisible on a phone, but on the desktop and web builds
/// this app also ships it meant the tape chart's own horizontal drag never
/// even started: not a bug in the chart's own paging logic, just a gesture
/// Flutter was never told to recognise.
class _AppScrollBehavior extends MaterialScrollBehavior {
  @override
  Set<PointerDeviceKind> get dragDevices => {
    PointerDeviceKind.touch,
    PointerDeviceKind.mouse,
    PointerDeviceKind.trackpad,
    PointerDeviceKind.stylus,
  };
}

/// Which app to show: the login screen, or the signed-in one.
///
/// Declarative rather than a splash screen that navigates. The session is the
/// single fact that decides this, so it is watched and the tree follows it —
/// which also means an expired session drops the desk back to login on its own,
/// with no navigator plumbing in the interceptor that noticed.
class AuthGate extends ConsumerWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(tokenProvider);

    // Only true before the first read of disk finishes. Routing on "no session
    // yet" as though it were "no session" would bounce a signed-in user to the
    // login screen for a frame.
    if (session.isLoading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return session.isLoggedIn ? const DashboardShell() : const LoginScreen();
  }
}
