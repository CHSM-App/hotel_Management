import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/network_service.dart';

final networkServiceProvider = Provider((ref) => NetworkService());

/// True when the phone can reach the world. Starts as loading, which the UI
/// reads as "assume it can" — a banner that flashes on every cold start would
/// train the desk to ignore it.
final networkStatusProvider = StreamProvider<bool>(
  (ref) => ref.watch(networkServiceProvider).onConnectivityChanged,
);
