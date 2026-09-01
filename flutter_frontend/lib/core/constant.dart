/// Where the backend lives.
///
/// The same server the web front desk talks to — there is one API and two
/// clients on it, so anything the phone can do the desk can do too, and neither
/// can drift from the other.
///
/// Overridable at build time without editing the file:
///   flutter run --dart-define=API_BASE_URL=http://192.168.1.5:8000
///
/// The default is the LAN address the web client is currently pointed at
/// (frontend/src/lib/api.js), so a phone on the same wifi reaches it. Swap it
/// for the public host when you build for a device that is not on that network.
const String baseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://192.168.1.5:8000',
);

/// Kept beside it so switching to production is one define rather than a hunt.
/// const String baseUrl = 'https://hotel.vengurlatech.com';
