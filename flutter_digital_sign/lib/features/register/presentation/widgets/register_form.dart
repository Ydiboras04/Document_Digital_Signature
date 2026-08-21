import 'package:flutter/material.dart';
import '../../../../core/crypto/ed25519_key_pair.dart';
import '../../../../core/network/user_api.dart';
import '../../../../core/storage/identity_storage.dart';

class RegisterForm extends StatefulWidget {
  final UserApi userApi;
  final IdentityStorage identityStorage;

  const RegisterForm({
    super.key,
    required this.userApi,
    required this.identityStorage,
  });

  @override
  State<RegisterForm> createState() => _RegisterFormState();
}

class _RegisterFormState extends State<RegisterForm> {
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  String? _errorMessage;
  bool _isSubmitting = false;

  @override
  void dispose() {
    _usernameController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    final keyPair = await Ed25519KeyPair.generate();
    final privateKeyBytes = await keyPair.extractPrivateKeyBytes();

    final result = await widget.userApi.register(
      _usernameController.text,
      _emailController.text,
      keyPair.publicKeyBytes,
    );

    if (!mounted) return;

    switch (result) {
      case RegisterSuccess(userId: final userId):
        await widget.identityStorage.save(
          userId,
          keyPair.publicKeyBytes,
          privateKeyBytes,
        );
        if (!mounted) return;
        Navigator.pushReplacementNamed(context, '/next');
      case RegisterFailure(message: final message):
        setState(() {
          _isSubmitting = false;
          _errorMessage = message;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'Register',
              style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 32),
            TextField(
              controller: _usernameController,
              decoration: const InputDecoration(
                labelText: 'Username',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _emailController,
              decoration: const InputDecoration(
                labelText: 'Email',
                border: OutlineInputBorder(),
              ),
            ),
            if (_errorMessage != null) ...[
              const SizedBox(height: 16),
              Text(_errorMessage!, style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: _isSubmitting ? null : _submit,
              child: const Text('Register', style: TextStyle(fontSize: 18)),
            ),
          ],
        ),
      ),
    );
  }
}
