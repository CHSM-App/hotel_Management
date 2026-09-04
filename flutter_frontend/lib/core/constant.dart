/// Where the backend lives.
///
/// The same server the web front desk talks to — there is one API and two
/// clients on it, so anything the phone can do the desk can do too, and neither
/// can drift from the other.
///
/// The default is production, because that is what a build with no flags is:
/// an APK handed to somebody. It used to be a LAN address, which meant the one
/// build nobody overrides — the release — was the one pointed at a developer's
/// desk.
///
/// Point it at the backend on your wifi while working, instead:
///   flutter run --dart-define=API_BASE_URL=http://192.168.1.5:8000
///
/// A cleartext http host also has to be named in
/// android/app/src/main/res/xml/network_security_config.xml, or Android will
/// refuse the connection without the app ever seeing it.
const String baseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://hotel.vengurlatech.com',
);
