/// A printing failure with wording fit to show the desk as-is.
class ThermalPrintException implements Exception {
  final String message;
  const ThermalPrintException(this.message);

  @override
  String toString() => message;
}

class BtDevice {
  final String name;
  final String mac;
  const BtDevice(this.name, this.mac);
}
