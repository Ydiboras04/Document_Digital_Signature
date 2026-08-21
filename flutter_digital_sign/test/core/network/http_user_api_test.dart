import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_digital_sign/core/network/user_api.dart';

void main() {
  group('HttpUserApi.register', () {
    test('returns RegisterSuccess with the userId on 201', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.toString(), 'http://localhost:3000/users');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['username'], 'dave');
        expect(body['email'], 'dave@example.com');
        expect(body['publicKeyBytes'], base64Encode([1, 2, 3]));

        return http.Response(
          jsonEncode({
            'id': 'user-123',
            'username': 'dave',
            'email': 'dave@example.com',
            'publicKey': 'abc',
          }),
          201,
        );
      });
      final api = HttpUserApi(client: mockClient);

      final result = await api.register('dave', 'dave@example.com', [1, 2, 3]);

      expect(result, isA<RegisterSuccess>());
      expect((result as RegisterSuccess).userId, 'user-123');
    });

    test('returns RegisterFailure with the server message on 409', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {
              'type': 'DuplicateEmailError',
              'message': 'Email dave@example.com is already registered',
            },
          }),
          409,
        );
      });
      final api = HttpUserApi(client: mockClient);

      final result = await api.register('dave', 'dave@example.com', [1, 2, 3]);

      expect(result, isA<RegisterFailure>());
      expect(
        (result as RegisterFailure).message,
        'Email dave@example.com is already registered',
      );
    });
  });
}
