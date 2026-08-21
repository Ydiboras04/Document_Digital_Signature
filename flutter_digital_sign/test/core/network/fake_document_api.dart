import 'package:flutter_digital_sign/core/network/document_api.dart';

class FakeDocumentApi implements DocumentApi {
  List<DocumentSummary> Function()? onListDocuments;
  DocumentDetail Function(String documentId)? onGetDocument;
  UploadResult Function(String title, List<int> fileBytes)? onUploadDocument;
  SignResult Function(String documentId, List<int> signatureBytes)? onSubmitSignature;
  VerificationResult Function(String documentId)? onVerifyDocument;

  int listCalls = 0;
  final List<String> getCalls = [];
  final List<({String title, List<int> fileBytes})> uploadCalls = [];
  final List<({String documentId, List<int> signatureBytes})> signCalls = [];
  final List<String> verifyCalls = [];

  @override
  Future<List<DocumentSummary>> listDocuments() async {
    listCalls++;
    return onListDocuments?.call() ?? [];
  }

  @override
  Future<DocumentDetail> getDocument(String documentId) async {
    getCalls.add(documentId);
    return onGetDocument!.call(documentId);
  }

  @override
  Future<UploadResult> uploadDocument(String title, List<int> fileBytes) async {
    uploadCalls.add((title: title, fileBytes: fileBytes));
    return onUploadDocument?.call(title, fileBytes) ?? UploadSuccess('fake-document-id');
  }

  @override
  Future<SignResult> submitSignature(String documentId, List<int> signatureBytes) async {
    signCalls.add((documentId: documentId, signatureBytes: signatureBytes));
    return onSubmitSignature?.call(documentId, signatureBytes) ?? SignSuccess();
  }

  @override
  Future<VerificationResult> verifyDocument(String documentId) async {
    verifyCalls.add(documentId);
    return onVerifyDocument!.call(documentId);
  }
}
