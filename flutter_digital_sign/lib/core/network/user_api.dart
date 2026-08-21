import 'dart:convert';
import 'package:http/http.dart' as http;

sealed class RegisterResult {}

class RegisterSuccess extends RegisterResult {
  final String userId;
  RegisterSuccess(this.userId);
}

class RegisterFailure extends RegisterResult {
  final String message;
  RegisterFailure(this.message);
}

abstract class UserApi {
  Future<RegisterResult> register(
    String username,
    String email,
    List<int> publicKeyBytes,
  );
}

class HttpUserApi implements UserApi {
  final String baseUrl;
  final http.Client _client;

  HttpUserApi({this.baseUrl = 'http://localhost:3000', http.Client? client})
      : _client = client ?? http.Client();

  @override
  Future<RegisterResult> register(
    String username,
    String email,
    List<int> publicKeyBytes,
  ) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/users'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'username': username,
        'email': email,
        'publicKeyBytes': base64Encode(publicKeyBytes),
      }),
    );

    final body = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 201) {
      return RegisterSuccess(body['id'] as String);
    }

    final error = body['error'] as Map<String, dynamic>?;
    final message = error?['message'] as String? ?? 'Registration failed';
    return RegisterFailure(message);
  }
}
