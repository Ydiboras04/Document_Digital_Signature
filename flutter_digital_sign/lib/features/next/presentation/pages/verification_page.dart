import 'package:flutter/material.dart';
import '../../../../core/network/document_api.dart';

/// Shows which signatures on a document actually verify cryptographically.
///
/// This is deliberately distinct from the signature count on the details page,
/// which counts stored rows. A row exists whether or not its signature is
/// genuine; only what this screen lists has been checked against the signer's
/// public key.
class VerificationPage extends StatefulWidget {
  final String documentId;
  final String documentTitle;
  final DocumentApi documentApi;

  const VerificationPage({
    super.key,
    required this.documentId,
    required this.documentTitle,
    required this.documentApi,
  });

  @override
  State<VerificationPage> createState() => _VerificationPageState();
}

class _VerificationPageState extends State<VerificationPage> {
  VerificationResult? _result;
  String? _errorMessage;
  // Retry is offered only when retrying could plausibly help -- never for a
  // permissions failure or a missing document, both of which will fail
  // identically on every retry.
  bool _canRetry = true;

  @override
  void initState() {
    super.initState();
    _verify();
  }

  Future<void> _verify() async {
    setState(() {
      _result = null;
      _errorMessage = null;
      _canRetry = true;
    });
    try {
      final result = await widget.documentApi.verifyDocument(widget.documentId);
      if (!mounted) return;
      setState(() {
        _result = result;
      });
    } on VerificationRequestException catch (e) {
      // A 403 and a 404 are not verification outcomes and not network
      // problems either -- rendering either as "can't reach the server"
      // sends an admin to debug their connection instead of their
      // permissions or the document id.
      if (!mounted) return;
      setState(() {
        switch (e.statusCode) {
          case 403:
            _errorMessage = e.message;
            _canRetry = false;
          case 404:
            _errorMessage = e.message;
            _canRetry = false;
          default:
            _errorMessage = 'Could not reach the server to verify this document.';
            _canRetry = true;
        }
      });
    } catch (_) {
      // Deliberately NOT rendered as a verification failure: the request did
      // not complete, so we know nothing about the document either way.
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Could not reach the server to verify this document.';
        _canRetry = true;
      });
    }
  }

  String _formatSignedAt(DateTime signedAt) {
    String two(int n) => n.toString().padLeft(2, '0');
    final local = signedAt.toLocal();
    return '${local.year}-${two(local.month)}-${two(local.day)} ${two(local.hour)}:${two(local.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Signature Verification')),
      body: Padding(
        padding: const EdgeInsets.all(20.0),
        child: _body(),
      ),
    );
  }

  Widget _body() {
    final errorMessage = _errorMessage;
    if (errorMessage != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(errorMessage, textAlign: TextAlign.center),
            if (_canRetry) ...[
              const SizedBox(height: 12),
              ElevatedButton(onPressed: _verify, child: const Text('Retry')),
            ],
          ],
        ),
      );
    }

    final result = _result;
    if (result == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return switch (result) {
      VerificationInvalid(reason: final reason) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.gpp_bad, color: Colors.red, size: 32),
                const SizedBox(width: 12),
                const Expanded(
                  child: Text(
                    'Verification failed',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.red),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(widget.documentTitle, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            Text(reason),
          ],
        ),
      VerificationValid(signers: final signers) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.verified_user, color: Colors.green, size: 32),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    signers.isEmpty ? 'Document intact' : 'Signatures cryptographically verified',
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.green),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(widget.documentTitle, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 20),
            if (signers.isEmpty)
              const Text('No signatures on this document yet.')
            else
              Expanded(
                child: ListView.separated(
                  itemCount: signers.length,
                  separatorBuilder: (context, index) => const Divider(),
                  itemBuilder: (context, index) {
                    final signer = signers[index];
                    return ListTile(
                      leading: const Icon(Icons.check_circle, color: Colors.green),
                      title: Text(signer.username),
                      subtitle: Text('${signer.email}\nsigned ${_formatSignedAt(signer.signedAt)}'),
                      isThreeLine: true,
                    );
                  },
                ),
              ),
          ],
        ),
    };
  }
}
