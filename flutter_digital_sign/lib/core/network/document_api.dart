import 'dart:convert';
import 'package:http/http.dart' as http;
import '../auth/auth_session.dart';

class DocumentSummary {
  final String id;
  final String title;
  final String uploaderId;
  final bool signedByUser;

  DocumentSummary({
    required this.id,
    required this.title,
    required this.uploaderId,
    required this.signedByUser,
  });

  factory DocumentSummary.fromJson(Map<String, dynamic> json) {
    return DocumentSummary(
      id: json['id'] as String,
      title: json['title'] as String,
      uploaderId: json['uploaderId'] as String,
      signedByUser: json['signedByUser'] as bool,
    );
  }
}

class DocumentSignature {
  final String userId;
  final DateTime signedAt;

  DocumentSignature({required this.userId, required this.signedAt});

  factory DocumentSignature.fromJson(Map<String, dynamic> json) {
    return DocumentSignature(
      userId: json['userId'] as String,
      signedAt: DateTime.parse(json['signedAt'] as String),
    );
  }
}

class DocumentDetail {
  final String id;
  final String title;
  final String uploaderId;
  final List<DocumentSignature> signatures;
  final bool signedByUser;
  final List<int>? signingPayload;

  DocumentDetail({
    required this.id,
    required this.title,
    required this.uploaderId,
    required this.signatures,
    required this.signedByUser,
    required this.signingPayload,
  });

  factory DocumentDetail.fromJson(Map<String, dynamic> json) {
    return DocumentDetail(
      id: json['id'] as String,
      title: json['title'] as String,
      uploaderId: json['uploaderId'] as String,
      signatures: (json['signatures'] as List)
          .map((s) => DocumentSignature.fromJson(s as Map<String, dynamic>))
          .toList(),
      signedByUser: json['signedByUser'] as bool,
      signingPayload:
          json['signingPayload'] == null ? null : base64Decode(json['signingPayload'] as String),
    );
  }
}

sealed class UploadResult {}

class UploadSuccess extends UploadResult {
  final String documentId;
  UploadSuccess(this.documentId);
}

class UploadFailure extends UploadResult {
  final String message;
  UploadFailure(this.message);
}

sealed class SignResult {}

class SignSuccess extends SignResult {}

class SignFailure extends SignResult {
  final String message;
  SignFailure(this.message);
}

abstract class DocumentApi {
  Future<List<DocumentSummary>> listDocuments();
  Future<DocumentDetail> getDocument(String documentId);
  Future<UploadResult> uploadDocument(String title, List<int> fileBytes);
  Future<SignResult> submitSignature(String documentId, List<int> signatureBytes);
}

class HttpDocumentApi implements DocumentApi {
  final String baseUrl;
  final http.Client _client;
  final AuthSession _authSession;

  HttpDocumentApi({
    this.baseUrl = 'http://localhost:3000',
    http.Client? client,
    required this._authSession,
  }) : _client = client ?? http.Client();

  /// Sends [request] with a bearer token. On a 401 the token is discarded and
  /// the request is retried exactly once with a freshly obtained one, which is
  /// what makes token expiry invisible to the caller.
  Future<http.Response> _send(Future<http.Response> Function(String token) request) async {
    var response = await request(await _authSession.token());
    if (response.statusCode == 401) {
      _authSession.invalidate();
      response = await request(await _authSession.token());
    }
    return response;
  }

  Map<String, String> _headers(String token) => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      };

  @override
  Future<List<DocumentSummary>> listDocuments() async {
    final response = await _send(
      (token) => _client.get(Uri.parse('$baseUrl/documents'), headers: _headers(token)),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to load documents');
    }
    final body = jsonDecode(response.body) as List;
    return body.map((d) => DocumentSummary.fromJson(d as Map<String, dynamic>)).toList();
  }

  @override
  Future<DocumentDetail> getDocument(String documentId) async {
    final response = await _send(
      (token) => _client.get(Uri.parse('$baseUrl/documents/$documentId'), headers: _headers(token)),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to load document');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return DocumentDetail.fromJson(body);
  }

  @override
  Future<UploadResult> uploadDocument(String title, List<int> fileBytes) async {
    final response = await _send(
      (token) => _client.post(
        Uri.parse('$baseUrl/documents'),
        headers: _headers(token),
        body: jsonEncode({'title': title, 'fileBytes': base64Encode(fileBytes)}),
      ),
    );

    final body = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 201) {
      return UploadSuccess(body['id'] as String);
    }

    final error = body['error'] as Map<String, dynamic>?;
    return UploadFailure(error?['message'] as String? ?? 'Upload failed');
  }

  @override
  Future<SignResult> submitSignature(String documentId, List<int> signatureBytes) async {
    final response = await _send(
      (token) => _client.post(
        Uri.parse('$baseUrl/documents/$documentId/signatures'),
        headers: _headers(token),
        body: jsonEncode({'signatureBytes': base64Encode(signatureBytes)}),
      ),
    );

    if (response.statusCode == 201) {
      return SignSuccess();
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final error = body['error'] as Map<String, dynamic>?;
    return SignFailure(error?['message'] as String? ?? 'Signing failed');
  }
}
