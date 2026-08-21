import 'package:flutter/material.dart';
import 'signing_confirmation_page.dart';
import 'verification_page.dart';
import '../../../../app/routes/app_routes.dart';
import '../../../../core/auth/auth_session.dart';
import '../../../../core/crypto/ed25519_key_pair.dart';
import '../../../../core/network/auth_api.dart';
import '../../../../core/network/document_api.dart';
import '../../../../core/storage/identity_storage.dart';

class DocumentDetailsPage extends StatefulWidget {
  final String documentId;
  final DocumentApi? documentApi;
  final IdentityStorage? identityStorage;
  final AuthSession? authSession;

  const DocumentDetailsPage({
    super.key,
    required this.documentId,
    this.documentApi,
    this.identityStorage,
    this.authSession,
  });

  @override
  State<DocumentDetailsPage> createState() => _DocumentDetailsPageState();
}

class _DocumentDetailsPageState extends State<DocumentDetailsPage> {
  late final DocumentApi _documentApi;
  late final IdentityStorage _identityStorage;
  late final AuthSession _authSession;
  bool _isAdmin = false;
  DocumentDetail? _detail;
  String? _errorMessage;
  bool _isSigning = false;

  @override
  void initState() {
    super.initState();
    _identityStorage = widget.identityStorage ?? IdentityStorage();
    _authSession = widget.authSession ??
        AuthSession(authApi: HttpAuthApi(), identityStorage: _identityStorage);
    _documentApi = widget.documentApi ?? HttpDocumentApi(authSession: _authSession);
    _load();
  }

  Future<void> _load() async {
    try {
      final admin = await _authSession.isAdmin();
      final detail = await _documentApi.getDocument(widget.documentId);
      if (!mounted) return;
      setState(() {
        _isAdmin = admin;
        _detail = detail;
      });
    } on UnknownIdentityException {
      await _recoverFromStaleIdentity();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Failed to load document.';
      });
    }
  }

  /// The server does not know this device's identity -- most likely the
  /// database was rebuilt. The private key can never be re-associated, so the
  /// only way forward is to discard it and register again.
  Future<void> _recoverFromStaleIdentity() async {
    await _identityStorage.clear();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('This device\'s identity is no longer recognised. Please register again.')),
    );
    Navigator.pushReplacementNamed(context, AppRoutes.register);
  }

  Future<void> _confirmSignature() async {
    final detail = _detail;
    if (detail == null || detail.signingPayload == null) return;

    setState(() {
      _isSigning = true;
      _errorMessage = null;
    });

    try {
      final identity = await _identityStorage.load();
      if (identity == null) {
        if (!mounted) return;
        setState(() {
          _isSigning = false;
          _errorMessage = 'No identity found on this device.';
        });
        return;
      }

      final signatureBytes = await Ed25519KeyPair.sign(
        identity.privateKeyBytes,
        detail.signingPayload!,
      );

      final result = await _documentApi.submitSignature(widget.documentId, signatureBytes);

      if (!mounted) return;

      switch (result) {
        case SignSuccess():
          await Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => SigningConfirmationPage(documentName: detail.title),
            ),
          );
          if (!mounted) return;
          setState(() {
            _isSigning = false;
          });
          await _load();
        case SignFailure(message: final message):
          setState(() {
            _isSigning = false;
            _errorMessage = message;
          });
      }
    } on UnknownIdentityException {
      if (mounted) {
        setState(() {
          _isSigning = false;
        });
      }
      await _recoverFromStaleIdentity();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _isSigning = false;
        _errorMessage = 'Failed to sign document.';
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
          _InfoRow(label: 'Signatures on record', value: '${detail.signatures.length}'),
          if (_isAdmin) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.verified_user),
              label: const Text('Verify signatures'),
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => VerificationPage(
                      documentId: widget.documentId,
                      documentTitle: detail.title,
                      documentApi: _documentApi,
                    ),
                  ),
                );
              },
            ),
          ],
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
                onPressed: (_isSigning || detail.signingPayload == null) ? null : _confirmSignature,
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
