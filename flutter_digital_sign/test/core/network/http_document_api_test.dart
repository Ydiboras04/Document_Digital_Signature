import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_digital_sign/core/network/document_api.dart';

void main() {
  group('HttpDocumentApi.listDocuments', () {
    test('returns the decoded list of document summaries', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.toString(), 'http://localhost:3000/documents?userId=user-1');
        return http.Response(
          jsonEncode([
            {'id': 'doc-1', 'title': 'Contract', 'uploaderId': 'user-1', 'signedByUser': false}
          ]),
          200,
        );
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.listDocuments('user-1');

      expect(result, hasLength(1));
      expect(result.first.id, 'doc-1');
      expect(result.first.title, 'Contract');
      expect(result.first.signedByUser, false);
    });
  });

  group('HttpDocumentApi.getDocument', () {
    test('decodes a detail response with a base64 signing payload', () async {
      final mockClient = MockClient((request) async {
        expect(request.url.toString(), 'http://localhost:3000/documents/doc-1?userId=user-1');
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
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.getDocument('doc-1', 'user-1');

      expect(result.id, 'doc-1');
      expect(result.signedByUser, false);
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
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.getDocument('doc-1', 'user-1');

      expect(result.signedByUser, true);
      expect(result.signingPayload, isNull);
      expect(result.signatures, hasLength(1));
      expect(result.signatures.first.userId, 'user-1');
    });
  });

  group('HttpDocumentApi.uploadDocument', () {
    test('returns UploadSuccess with the document id on 201', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.toString(), 'http://localhost:3000/documents');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['title'], 'Contract.pdf');
        expect(body['uploaderId'], 'user-1');
        expect(body['fileBytes'], base64Encode([1, 2, 3]));
        return http.Response(jsonEncode({'id': 'doc-1', 'title': 'Contract.pdf'}), 201);
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.uploadDocument('Contract.pdf', 'user-1', [1, 2, 3]);

      expect(result, isA<UploadSuccess>());
      expect((result as UploadSuccess).documentId, 'doc-1');
    });

    test('returns UploadFailure with the server message on a validation error', () async {
      final mockClient = MockClient((request) async {
        return http.Response(
          jsonEncode({
            'error': {'type': 'ValidationError', 'message': 'title, uploaderId, and fileBytes are required strings'}
          }),
          400,
        );
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.uploadDocument('', 'user-1', [1, 2, 3]);

      expect(result, isA<UploadFailure>());
      expect((result as UploadFailure).message, 'title, uploaderId, and fileBytes are required strings');
    });
  });

  group('HttpDocumentApi.submitSignature', () {
    test('returns SignSuccess on 201', () async {
      final mockClient = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.toString(), 'http://localhost:3000/documents/doc-1/signatures');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['userId'], 'user-1');
        expect(body['signatureBytes'], base64Encode([9, 9, 9]));
        return http.Response(jsonEncode({'id': 'sig-1'}), 201);
      });
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.submitSignature('doc-1', 'user-1', [9, 9, 9]);

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
      final api = HttpDocumentApi(client: mockClient);

      final result = await api.submitSignature('doc-1', 'user-1', [9, 9, 9]);

      expect(result, isA<SignFailure>());
      expect((result as SignFailure).message, 'User user-1 has already signed this document');
    });
  });
}
