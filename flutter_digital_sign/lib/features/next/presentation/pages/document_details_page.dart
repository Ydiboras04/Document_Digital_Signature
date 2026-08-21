import 'package:flutter/material.dart';
import 'signing_confirmation_page.dart';
import '../../../../core/crypto/ed25519_key_pair.dart';
import '../../../../core/network/document_api.dart';
import '../../../../core/storage/identity_storage.dart';

class DocumentDetailsPage extends StatefulWidget {
  final String documentId;
  final DocumentApi? documentApi;
  final IdentityStorage? identityStorage;

  const DocumentDetailsPage({
    super.key,
    required this.documentId,
    this.documentApi,
    this.identityStorage,
  });

  @override
  State<DocumentDetailsPage> createState() => _DocumentDetailsPageState();
}

class _DocumentDetailsPageState extends State<DocumentDetailsPage> {
  late final DocumentApi _documentApi;
  late final IdentityStorage _identityStorage;
  DocumentDetail? _detail;
  String? _userId;
  String? _errorMessage;
  bool _isSigning = false;

  @override
  void initState() {
    super.initState();
    _documentApi = widget.documentApi ?? HttpDocumentApi();
    _identityStorage = widget.identityStorage ?? IdentityStorage();
    _load();
  }

  Future<void> _load() async {
    final identity = await _identityStorage.load();
    if (identity == null) {
      setState(() {
        _errorMessage = 'No identity found on this device.';
      });
      return;
    }
    _userId = identity.userId;
    try {
      final detail = await _documentApi.getDocument(widget.documentId, identity.userId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Failed to load document.';
      });
    }
  }

  Future<void> _confirmSignature() async {
    final detail = _detail;
    final userId = _userId;
    if (detail == null || userId == null || detail.signingPayload == null) return;

    setState(() {
      _isSigning = true;
      _errorMessage = null;
    });

    final identity = await _identityStorage.load();
    final signatureBytes = await Ed25519KeyPair.sign(
      identity!.privateKeyBytes,
      detail.signingPayload!,
    );

    final result = await _documentApi.submitSignature(widget.documentId, userId, signatureBytes);

    if (!mounted) return;

    switch (result) {
      case SignSuccess():
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => SigningConfirmationPage(documentName: detail.title),
          ),
        );
      case SignFailure(message: final message):
        setState(() {
          _isSigning = false;
          _errorMessage = message;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    Widget body;
    if (detail == null && _errorMessage != null) {
      body = Center(child: Text(_errorMessage!, style: const TextStyle(color: Colors.red)));
    } else if (detail == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.red.shade50,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.picture_as_pdf, size: 48, color: Colors.red),
                const SizedBox(height: 12),
                const Text(
                  'Selected Document',
                  style: TextStyle(fontSize: 14, color: Colors.grey),
                ),
                const SizedBox(height: 8),
                Text(
                  detail.title,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'Document Information',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          _InfoRow(label: 'Uploader', value: detail.uploaderId),
          _InfoRow(label: 'Signatures', value: '${detail.signatures.length}'),
          if (_errorMessage != null) ...[
            const SizedBox(height: 16),
            Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
          ],
          const Spacer(),
          if (detail.signedByUser)
            const Text(
              'You have already signed this document.',
              style: TextStyle(fontWeight: FontWeight.w600),
            )
          else
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isSigning ? null : _confirmSignature,
                child: const Text('Confirm Signature'),
              ),
            ),
        ],
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Document Details')),
      body: Padding(padding: const EdgeInsets.all(20.0), child: body),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(color: Colors.grey),
          ),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}
