import 'package:flutter_digital_sign/core/network/document_api.dart';

class FakeDocumentApi implements DocumentApi {
  List<DocumentSummary> Function(String userId)? onListDocuments;
  DocumentDetail Function(String documentId, String userId)? onGetDocument;
  UploadResult Function(String title, String uploaderId, List<int> fileBytes)? onUploadDocument;
  SignResult Function(String documentId, String userId, List<int> signatureBytes)? onSubmitSignature;

  final List<String> listCalls = [];
  final List<({String documentId, String userId})> getCalls = [];
  final List<({String title, String uploaderId, List<int> fileBytes})> uploadCalls = [];
  final List<({String documentId, String userId, List<int> signatureBytes})> signCalls = [];

  @override
  Future<List<DocumentSummary>> listDocuments(String userId) async {
    listCalls.add(userId);
    return onListDocuments?.call(userId) ?? [];
  }

  @override
  Future<DocumentDetail> getDocument(String documentId, String userId) async {
    getCalls.add((documentId: documentId, userId: userId));
    return onGetDocument!.call(documentId, userId);
  }

  @override
  Future<UploadResult> uploadDocument(String title, String uploaderId, List<int> fileBytes) async {
    uploadCalls.add((title: title, uploaderId: uploaderId, fileBytes: fileBytes));
    return onUploadDocument?.call(title, uploaderId, fileBytes) ?? UploadSuccess('fake-document-id');
  }

  @override
  Future<SignResult> submitSignature(String documentId, String userId, List<int> signatureBytes) async {
    signCalls.add((documentId: documentId, userId: userId, signatureBytes: signatureBytes));
    return onSubmitSignature?.call(documentId, userId, signatureBytes) ?? SignSuccess();
  }
}
