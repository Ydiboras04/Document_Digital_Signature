import 'dart:convert';

/// Builds a realistically-shaped JWT with a genuine base64url payload.
///
/// The signature segment is a placeholder: the client never verifies it, it
/// only reads claims for UI decisions. `FakeAuthApi`'s default of returning a
/// bare string like 'fake-token' cannot be decoded, so tests that exercise
/// claim-reading need this instead of a stub.
String unsignedJwt(Map<String, dynamic> payload) {
  String segment(Map<String, dynamic> json) =>
      base64Url.encode(utf8.encode(jsonEncode(json))).replaceAll('=', '');

  return '${segment({'alg': 'HS256', 'typ': 'JWT'})}.${segment(payload)}.signature';
}
