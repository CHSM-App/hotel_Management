import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';

/// Whether the phone can actually reach anything.
///
/// Two different questions, and the difference matters at a front desk: the
/// handset can be firmly attached to the property's wifi while the router has
/// no line out, and "connected" would be a lie. So a cold start asks both — is
/// there an interface, and does a name actually resolve — and after that the
/// platform stream carries it.
class NetworkService {
  final Connectivity _connectivity = Connectivity();

  Stream<bool> get onConnectivityChanged async* {
    yield await hasInterface();
    yield await canReachInternet();
    await for (final result in _connectivity.onConnectivityChanged) {
      yield !result.contains(ConnectivityResult.none);
    }
  }

  Future<bool> hasInterface() async =>
      !(await _connectivity.checkConnectivity()).contains(
        ConnectivityResult.none,
      );

  Future<bool> canReachInternet() async {
    try {
      final result = await InternetAddress.lookup(
        'one.one.one.one',
      ).timeout(const Duration(seconds: 4));
      return result.isNotEmpty && result.first.rawAddress.isNotEmpty;
    } catch (_) {
      return false;
    }
  }
}
