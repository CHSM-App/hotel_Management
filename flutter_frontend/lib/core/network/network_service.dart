import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';

import '../constant.dart';

/// Whether the phone can actually reach anything.
///
/// Two different questions, and the difference matters at a front desk: the
/// handset can be firmly attached to the property's wifi while the router has
/// no line out, and "connected" would be a lie. So a cold start asks both — is
/// there an interface, and does the backend itself actually respond — and
/// after that the platform stream carries it.
///
/// The reachability probe targets [baseUrl] rather than a public DNS name: a
/// desk running against a LAN backend has no reason to also have general
/// internet access, and checking one.one.one.one flagged that setup as
/// offline even though the one server this app talks to was right there.
class NetworkService {
  final Connectivity _connectivity = Connectivity();

  Stream<bool> get onConnectivityChanged async* {
    yield await hasInterface();
    yield await canReachBackend();
    await for (final result in _connectivity.onConnectivityChanged) {
      yield !result.contains(ConnectivityResult.none) &&
          await canReachBackend();
    }
  }

  Future<bool> hasInterface() async =>
      !(await _connectivity.checkConnectivity()).contains(
        ConnectivityResult.none,
      );

  Future<bool> canReachBackend() async {
    final uri = Uri.parse(baseUrl);
    final port = uri.hasPort
        ? uri.port
        : (uri.scheme == 'https' ? 443 : 80);
    try {
      final socket = await Socket.connect(
        uri.host,
        port,
        timeout: const Duration(seconds: 4),
      );
      socket.destroy();
      return true;
    } catch (_) {
      return false;
    }
  }
}
