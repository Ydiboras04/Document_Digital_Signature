import 'package:flutter/material.dart';
import '../widgets/welcome_content.dart';
import '../../../../core/storage/identity_storage.dart';

class WelcomePage extends StatefulWidget {
  final IdentityStorage? identityStorage;

  const WelcomePage({super.key, this.identityStorage});

  @override
  State<WelcomePage> createState() => _WelcomePageState();
}

class _WelcomePageState extends State<WelcomePage> {
  late final IdentityStorage _identityStorage;
  bool _isChecking = true;

  @override
  void initState() {
    super.initState();
    _identityStorage = widget.identityStorage ?? IdentityStorage();
    _checkExistingIdentity();
  }

  Future<void> _checkExistingIdentity() async {
    final identity = await _identityStorage.load();
    if (!mounted) return;
    if (identity != null) {
      Navigator.pushReplacementNamed(context, '/next');
      return;
    }
    setState(() {
      _isChecking = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_isChecking) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return const Scaffold(body: WelcomeContent());
  }
}
