import 'package:flutter/material.dart';
import '../widgets/next_content.dart';
import '../../../../core/auth/auth_session.dart';
import '../../../../core/network/auth_api.dart';
import '../../../../core/network/document_api.dart';
import '../../../../core/storage/identity_storage.dart';

class NextPage extends StatefulWidget {
  final DocumentApi? documentApi;
  final IdentityStorage? identityStorage;

  const NextPage({super.key, this.documentApi, this.identityStorage});

  @override
  State<NextPage> createState() => _NextPageState();
}

class _NextPageState extends State<NextPage> {
  late final DocumentApi _documentApi;
  late final IdentityStorage _identityStorage;

  @override
  void initState() {
    super.initState();
    _identityStorage = widget.identityStorage ?? IdentityStorage();
    _documentApi = widget.documentApi ??
        HttpDocumentApi(
          authSession: AuthSession(
            authApi: HttpAuthApi(),
            identityStorage: _identityStorage,
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Digital Signature'),
      ),
      body: NextContent(
        documentApi: _documentApi,
        identityStorage: _identityStorage,
      ),
    );
  }
}
