import 'package:flutter/material.dart';
import '../widgets/next_content.dart';
import '../../../../core/network/document_api.dart';
import '../../../../core/storage/identity_storage.dart';

class NextPage extends StatelessWidget {
  final DocumentApi? documentApi;
  final IdentityStorage? identityStorage;

  const NextPage({super.key, this.documentApi, this.identityStorage});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Digital Signature'),
      ),
      body: NextContent(
        documentApi: documentApi ?? HttpDocumentApi(),
        identityStorage: identityStorage ?? IdentityStorage(),
      ),
    );
  }
}
