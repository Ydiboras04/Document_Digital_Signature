import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_digital_sign/core/auth/auth_session.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';
import 'package:flutter_digital_sign/core/storage/identity_storage.dart';
import 'fake_auth_api.dart';

Future<AuthSession> aSession({String token = 'tok-1'}) async {
  final identityStorage = IdentityStorage();
  await identityStorage.save('user-1', List<int>.filled(32, 1), List<int>.generate(32, (i) => i));
  final authApi = FakeAuthApi()..onExchangeForToken = ((userId, signature) => token);
  return AuthSession(authApi: authApi, identityStorage: identityStorage);
}

/// A session whose fake auth API issues [tokens] in order, one per handshake
/// (i.e. one per call to `token()` that isn't served from the cache). Used to
/// prove that a 401 actually discards the stale token rather than just
/// resending it.
Future<AuthSession> aSessionWithTokens(List<String> tokens) async {
  final identityStorage = IdentityStorage();
  await identityStorage.save('user-1', List<int>.filled(32, 1), List<int>.generate(32, (i) => i));
  var handshakes = 0;
  final authApi = FakeAuthApi()
    ..onExchangeForToken = ((userId, signature) {
      final token = tokens[handshakes];
      if (handshakes < tokens.length - 1) handshakes++;
      return token;
    });
  return AuthSession(authApi: authApi, identityStorage: identityStorage);
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  group('HttpDocumentApi.listDocuments', () {
    test('sends the bearer token and no userId parameter', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.toString(), 'http://localhost:3000/documents');
        expect(request.headers['Authorization'], 'Bearer tok-1');
        return http.Response(
          jsonEncode([
            {'id': 'doc-1', 'title': 'Contract', 'uploaderId': 'user-1', 'signedByUser': false}
          ]),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.listDocuments();

      expect(result, hasLength(1));
      expect(result.first.id, 'doc-1');
    });

    test('re-authenticates and retries exactly once on 401', () async {
      var calls = 0;
      final mockClient = MockClient((request) async {
        calls++;
        if (calls == 1) {
          return http.Response(jsonEncode({'error': 'expired'}), 401);
        }
        return http.Response(jsonEncode([]), 200);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.listDocuments();

      expect(calls, 2);
      expect(result, isEmpty);
    });

    test('does not loop when the retry also returns 401', () async {
      var calls = 0;
      final mockClient = MockClient((request) async {
        calls++;
        return http.Response(jsonEncode({'error': 'expired'}), 401);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      await expectLater(() => api.listDocuments(), throwsA(isA<Exception>()));
      expect(calls, 2);
    });

    test('discards the stale token so the retry carries a freshly issued one', () async {
      var calls = 0;
      final mockClient = MockClient((request) async {
        calls++;
        if (calls == 1) {
          expect(request.headers['Authorization'], 'Bearer tok-1');
          return http.Response(jsonEncode({'error': 'expired'}), 401);
        }
        expect(request.headers['Authorization'], 'Bearer tok-2');
        return http.Response(jsonEncode([]), 200);
      });
      final api = HttpDocumentApi(
        client: mockClient,
        authSession: await aSessionWithTokens(['tok-1', 'tok-2']),
      );

      final result = await api.listDocuments();

      expect(calls, 2);
      expect(result, isEmpty);
    });
  });

  group('HttpDocumentApi.getDocument', () {
    test('requests the document with no userId parameter', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.toString(), 'http://localhost:3000/documents/doc-1');
        expect(request.headers['Authorization'], 'Bearer tok-1');
        return http.Response(
          jsonEncode({
            'id': 'doc-1',
            'title': 'Contract',
            'uploaderId': 'user-1',
            'signatures': [],
            'signedByUser': false,
            'signingPayload': base64Encode([1, 2, 3]),
          }),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.getDocument('doc-1');

      expect(result.signingPayload, [1, 2, 3]);
    });

    test('decodes signatures and a null signing payload once signed', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'id': 'doc-1',
            'title': 'Contract',
            'uploaderId': 'user-1',
            'signatures': [
              {'userId': 'user-1', 'signedAt': '2026-08-20T00:00:00.000Z'}
            ],
            'signedByUser': true,
            'signingPayload': null,
          }),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.getDocument('doc-1');

      expect(result.signedByUser, true);
      expect(result.signingPayload, isNull);
      expect(result.signatures, hasLength(1));
      expect(result.signatures.first.userId, 'user-1');
    });
  });

  group('HttpDocumentApi.uploadDocument', () {
    test('posts title and fileBytes only, with the bearer token', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.toString(), 'http://localhost:3000/documents');
        expect(request.headers['Authorization'], 'Bearer tok-1');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['title'], 'Contract.pdf');
        expect(body['fileBytes'], base64Encode([1, 2, 3]));
        expect(body.containsKey('uploaderId'), isFalse);
        return http.Response(jsonEncode({'id': 'doc-1'}), 201);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.uploadDocument('Contract.pdf', [1, 2, 3]);

      expect(result, isA<UploadSuccess>());
      expect((result as UploadSuccess).documentId, 'doc-1');
    });

    test('returns UploadFailure with the server message on a validation error', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'ValidationError', 'message': 'title and fileBytes are required strings'}
          }),
          400,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.uploadDocument('', [1, 2, 3]);

      expect(result, isA<UploadFailure>());
      expect((result as UploadFailure).message, 'title and fileBytes are required strings');
    });

    test('returns UploadFailure when a repeated 401 answers with a plain-text body', () async {
      // Hono's jwt middleware answers a rejected token with the plain text
      // "Unauthorized", which is not decodable JSON.
      var calls = 0;
      final mockClient = MockClient((request) async {
        calls++;
        return http.Response('Unauthorized', 401);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.uploadDocument('Contract.pdf', [1, 2, 3]);

      expect(calls, 2);
      expect(result, isA<UploadFailure>());
      expect((result as UploadFailure).message, 'Upload failed');
    });
  });

  group('HttpDocumentApi.submitSignature', () {
    test('posts signatureBytes only, with the bearer token', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.toString(), 'http://localhost:3000/documents/doc-1/signatures');
        expect(request.headers['Authorization'], 'Bearer tok-1');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['signatureBytes'], base64Encode([9, 9, 9]));
        expect(body.containsKey('userId'), isFalse);
        return http.Response(jsonEncode({'id': 'sig-1'}), 201);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.submitSignature('doc-1', [9, 9, 9]);

      expect(result, isA<SignSuccess>());
    });

    test('returns SignFailure with the server message on a duplicate signature', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'DuplicateSignatureError', 'message': 'User user-1 has already signed this document'}
          }),
          409,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.submitSignature('doc-1', [9, 9, 9]);

      expect(result, isA<SignFailure>());
      expect((result as SignFailure).message, 'User user-1 has already signed this document');
    });

    test('returns SignFailure when a repeated 401 answers with a plain-text body', () async {
      final mockClient = MockClient((request) async => http.Response('Unauthorized', 401));
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.submitSignature('doc-1', [9, 9, 9]);

      expect(result, isA<SignFailure>());
      expect((result as SignFailure).message, 'Signing failed');
    });
  });

  group('HttpDocumentApi.verifyDocument', () {
    test('returns VerificationValid with the named signers', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.toString(), 'http://localhost:3000/documents/doc-1/verify');
        expect(request.headers['Authorization'], 'Bearer tok-1');
        return http.Response(
          jsonEncode({
            'valid': true,
            'signatures': [
              {
                'userId': 'user-alice',
                'username': 'alice',
                'email': 'alice@example.com',
                'signedAt': '2026-08-21T07:08:00.000Z',
              }
            ],
          }),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.verifyDocument('doc-1');

      expect(result, isA<VerificationValid>());
      final signers = (result as VerificationValid).signers;
      expect(signers, hasLength(1));
      expect(signers.first.username, 'alice');
      expect(signers.first.email, 'alice@example.com');
      expect(signers.first.userId, 'user-alice');
      expect(signers.first.signedAt, DateTime.utc(2026, 8, 21, 7, 8));
    });

    test('returns VerificationValid with no signers for an unsigned document', () async {
      final mockClient = MockClient((request) async {
        return http.Response(jsonEncode({'valid': true, 'signatures': []}), 200);
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.verifyDocument('doc-1');

      expect(result, isA<VerificationValid>());
      expect((result as VerificationValid).signers, isEmpty);
    });

    test('returns VerificationInvalid with the reason when the chain does not verify', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({'valid': false, 'reason': 'cryptographic verification failed'}),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      final result = await api.verifyDocument('doc-1');

      expect(result, isA<VerificationInvalid>());
      expect((result as VerificationInvalid).reason, 'cryptographic verification failed');
    });

    test('throws on a 403 rather than reporting it as a failed verification', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'ForbiddenError', 'message': 'Only an administrator may verify document signatures'}
          }),
          403,
        );
      });
      final api = HttpDocumentApi(client: mockClient, authSession: await aSession());

      expect(() => api.verifyDocument('doc-1'), throwsA(isA<Exception>()));
    });
  });
}
