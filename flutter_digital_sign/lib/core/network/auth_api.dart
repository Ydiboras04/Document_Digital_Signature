import 'dart:convert';
import 'package:http/http.dart' as http;

/// Thrown when the server does not recognise the identity stored on this
/// device. The private key can never be re-associated with a server-side
/// account, so the only recovery is to discard it and register again.
class UnknownIdentityException implements Exception {
  @override
  String toString() => 'UnknownIdentityException: this device\'s identity is unknown to the server';
}

abstract class AuthApi {
  Future<List<int>> requestChallenge(String userId);
  Future<String> exchangeForToken(String userId, List<int> signature);
}

class HttpAuthApi implements AuthApi {
  final String baseUrl;
  final http.Client _client;

  HttpAuthApi({this.baseUrl = 'http://localhost:3000', http.Client? client})
      : _client = client ?? http.Client();

  @override
  Future<List<int>> requestChallenge(String userId) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/auth/challenge'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'userId': userId}),
    );

    if (response.statusCode == 404) {
      throw UnknownIdentityException();
    }
    if (response.statusCode != 200) {
      throw Exception('Failed to request challenge');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return base64Decode(body['challenge'] as String);
  }

  @override
  Future<String> exchangeForToken(String userId, List<int> signature) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/auth/token'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'userId': userId,
        'signature': base64Encode(signature),
      }),
    );

    if (response.statusCode != 200) {
      throw Exception('Failed to exchange challenge for token');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return body['token'] as String;
  }
}
