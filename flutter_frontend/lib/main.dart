import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/network/token_provider.dart';
import 'screens/login_screen.dart';
import 'screens/shell/dashboard_shell.dart';
import 'screens/theme.dart';

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
      home: const AuthGate(),
    );
  }
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
