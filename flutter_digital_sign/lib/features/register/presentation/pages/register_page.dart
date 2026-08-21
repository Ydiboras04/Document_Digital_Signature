import 'package:flutter/material.dart';
import '../widgets/register_form.dart';
import '../../../../core/network/user_api.dart';
import '../../../../core/storage/identity_storage.dart';

class RegisterPage extends StatelessWidget {
  final UserApi? userApi;
  final IdentityStorage? identityStorage;

  const RegisterPage({super.key, this.userApi, this.identityStorage});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RegisterForm(
        userApi: userApi ?? HttpUserApi(),
        identityStorage: identityStorage ?? IdentityStorage(),
      ),
    );
  }
}
