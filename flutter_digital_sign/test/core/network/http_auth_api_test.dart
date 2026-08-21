import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_digital_sign/core/network/auth_api.dart';

void main() {
  group('HttpAuthApi.requestChallenge', () {
    test('posts the userId and returns the decoded challenge bytes', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.toString(), 'http://localhost:3000/auth/challenge');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['userId'], 'user-1');
        return http.Response(jsonEncode({'challenge': base64Encode([1, 2, 3])}), 200);
      });
      final api = HttpAuthApi(client: mockClient);

      final challenge = await api.requestChallenge('user-1');

      expect(challenge, [1, 2, 3]);
    });

    test('throws UnknownIdentityException on 404', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'UserNotFoundError', 'message': 'User user-1 was not found'}
          }),
          404,
        );
      });
      final api = HttpAuthApi(client: mockClient);

      expect(
        () => api.requestChallenge('user-1'),
        throwsA(isA<UnknownIdentityException>()),
      );
    });

    test('throws a generic Exception on a server error', () async {
      final mockClient = MockClient((request) async => http.Response('boom', 500));
      final api = HttpAuthApi(client: mockClient);

      expect(() => api.requestChallenge('user-1'), throwsA(isA<Exception>()));
    });
  });

  group('HttpAuthApi.exchangeForToken', () {
    test('posts the base64 signature and returns the token', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.toString(), 'http://localhost:3000/auth/token');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['userId'], 'user-1');
        expect(body['signature'], base64Encode([9, 9, 9]));
        return http.Response(jsonEncode({'token': 'a.b.c'}), 200);
      });
      final api = HttpAuthApi(client: mockClient);

      final token = await api.exchangeForToken('user-1', [9, 9, 9]);

      expect(token, 'a.b.c');
    });

    test('throws on 401', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'AuthenticationFailedError', 'message': 'Authentication failed'}
          }),
          401,
        );
      });
      final api = HttpAuthApi(client: mockClient);

      expect(() => api.exchangeForToken('user-1', [9, 9, 9]), throwsA(isA<Exception>()));
    });
  });
}
