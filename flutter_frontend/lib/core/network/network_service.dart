import 'dart:async';
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

  /// How often the backend is re-probed with no connectivity event to prompt
  /// it. connectivity_plus reports interfaces, not reachability, and on Windows
  /// it can stay silent through a router losing its line — so a stale "offline"
  /// would otherwise never heal on its own.
  static const reprobeEvery = Duration(seconds: 30);

  Stream<bool> get onConnectivityChanged {
    late final StreamController<bool> out;
    StreamSubscription? sub;
    Timer? timer;
    var probing = false;

    Future<void> probe({bool interfaceFirst = false}) async {
      if (probing || out.isClosed) return;
      probing = true;
      try {
        if (interfaceFirst) out.add(await hasInterface());
        var up = await hasInterface() && await canReachBackend();
        // One failed probe is often a blip (a dropped packet, wifi roaming).
        // Look again before telling the desk the connection is gone, so the
        // strip does not flicker on and off.
        if (!up && await hasInterface()) {
          await Future<void>.delayed(const Duration(seconds: 2));
          up = await canReachBackend();
        }
        if (!out.isClosed) out.add(up);
      } finally {
        probing = false;
      }
    }

    out = StreamController<bool>(
      onListen: () {
        probe(interfaceFirst: true);
        sub = _connectivity.onConnectivityChanged.listen((_) => probe());
        timer = Timer.periodic(reprobeEvery, (_) => probe());
      },
      onCancel: () async {
        timer?.cancel();
        await sub?.cancel();
      },
    );
    return out.stream;
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
