import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import '../pages/document_details_page.dart';
import '../../../../app/routes/app_routes.dart';
import '../../../../core/network/auth_api.dart';
import '../../../../core/network/document_api.dart';
import '../../../../core/storage/identity_storage.dart';

class NextContent extends StatefulWidget {
  final DocumentApi documentApi;
  final IdentityStorage identityStorage;

  const NextContent({
    super.key,
    required this.documentApi,
    required this.identityStorage,
  });

  @override
  State<NextContent> createState() => _NextContentState();
}

class _NextContentState extends State<NextContent> {
  List<DocumentSummary>? _documents;
  String? _errorMessage;
  String? _userId;

  @override
  void initState() {
    super.initState();
    _loadDocuments();
  }

  Future<void> _loadDocuments() async {
    final identity = await widget.identityStorage.load();
    if (identity == null) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'No identity found on this device.';
      });
      return;
    }
    _userId = identity.userId;
    try {
      final documents = await widget.documentApi.listDocuments();
      if (!mounted) return;
      setState(() {
        _documents = documents;
        _errorMessage = null;
      });
    } on UnknownIdentityException {
      await _recoverFromStaleIdentity();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Failed to load documents.';
      });
    }
  }

  /// The server does not know this device's identity -- most likely the
  /// database was rebuilt. The private key can never be re-associated, so the
  /// only way forward is to discard it and register again.
  Future<void> _recoverFromStaleIdentity() async {
    await widget.identityStorage.clear();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('This device\'s identity is no longer recognised. Please register again.')),
    );
    Navigator.pushReplacementNamed(context, AppRoutes.register);
  }

  Future<void> _upload() async {
    final userId = _userId;
    if (userId == null) return;
    final file = await FilePicker.pickFile();
    if (file == null) return;
    final bytes = await file.readAsBytes();

    final UploadResult result;
    try {
      result = await widget.documentApi.uploadDocument(file.name, bytes);
    } on UnknownIdentityException {
      await _recoverFromStaleIdentity();
      return;
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Failed to upload document.')),
      );
      return;
    }

    if (!mounted) return;
    switch (result) {
      case UploadSuccess():
        _loadDocuments();
      case UploadFailure(message: final message):
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Documents',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
              ),
              IconButton(
                icon: const Icon(Icons.upload_file),
                onPressed: _upload,
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Choose a document to sign.',
            style: TextStyle(fontSize: 16, color: Colors.grey),
          ),
          const SizedBox(height: 20),
          if (_errorMessage != null)
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_errorMessage!),
                    const SizedBox(height: 12),
                    ElevatedButton(
                      onPressed: _loadDocuments,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            )
          else if (_documents == null)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else
            Expanded(
              child: ListView.separated(
                itemCount: _documents!.length,
                separatorBuilder: (context, index) => const SizedBox(height: 12),
                itemBuilder: (context, index) {
                  final document = _documents![index];
                  return Card(
                    elevation: 1,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: ListTile(
                      leading: Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: Colors.red.shade50,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(
                          document.signedByUser ? Icons.lock : Icons.picture_as_pdf,
                          color: Colors.red,
                        ),
                      ),
                      title: Text(document.title),
                      subtitle: Text(document.signedByUser ? 'Signed' : 'Ready for signature'),
                      trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                      onTap: () async {
                        await Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => DocumentDetailsPage(
                              documentId: document.id,
                              documentApi: widget.documentApi,
                              identityStorage: widget.identityStorage,
                            ),
                          ),
                        );
                        if (!mounted) return;
                        _loadDocuments();
                      },
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}
