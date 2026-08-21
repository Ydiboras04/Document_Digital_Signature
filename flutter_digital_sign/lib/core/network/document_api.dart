import 'dart:convert';
import 'package:http/http.dart' as http;

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
  Future<List<DocumentSummary>> listDocuments(String userId);
  Future<DocumentDetail> getDocument(String documentId, String userId);
  Future<UploadResult> uploadDocument(String title, String uploaderId, List<int> fileBytes);
  Future<SignResult> submitSignature(String documentId, String userId, List<int> signatureBytes);
}

class HttpDocumentApi implements DocumentApi {
  final String baseUrl;
  final http.Client _client;

  HttpDocumentApi({this.baseUrl = 'http://localhost:3000', http.Client? client})
      : _client = client ?? http.Client();

  @override
  Future<List<DocumentSummary>> listDocuments(String userId) async {
    final response = await _client.get(Uri.parse('$baseUrl/documents?userId=$userId'));
    if (response.statusCode != 200) {
      throw Exception('Failed to load documents');
    }
    final body = jsonDecode(response.body) as List;
    return body.map((d) => DocumentSummary.fromJson(d as Map<String, dynamic>)).toList();
  }

  @override
  Future<DocumentDetail> getDocument(String documentId, String userId) async {
    final response = await _client.get(Uri.parse('$baseUrl/documents/$documentId?userId=$userId'));
    if (response.statusCode != 200) {
      throw Exception('Failed to load document');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return DocumentDetail.fromJson(body);
  }

  @override
  Future<UploadResult> uploadDocument(
    String title,
    String uploaderId,
    List<int> fileBytes,
  ) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/documents'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'title': title,
        'uploaderId': uploaderId,
        'fileBytes': base64Encode(fileBytes),
      }),
    );

    final body = jsonDecode(response.body) as Map<String, dynamic>;

    if (response.statusCode == 201) {
      return UploadSuccess(body['id'] as String);
    }

    final error = body['error'] as Map<String, dynamic>?;
    final message = error?['message'] as String? ?? 'Upload failed';
    return UploadFailure(message);
  }

  @override
  Future<SignResult> submitSignature(
    String documentId,
    String userId,
    List<int> signatureBytes,
  ) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/documents/$documentId/signatures'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'userId': userId,
        'signatureBytes': base64Encode(signatureBytes),
      }),
    );

    if (response.statusCode == 201) {
      return SignSuccess();
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final error = body['error'] as Map<String, dynamic>?;
    final message = error?['message'] as String? ?? 'Signing failed';
    return SignFailure(message);
  }
}
