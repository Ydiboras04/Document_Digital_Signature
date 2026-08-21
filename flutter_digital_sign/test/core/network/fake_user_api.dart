import 'package:flutter_digital_sign/core/network/user_api.dart';

class FakeUserApi implements UserApi {
  RegisterResult Function(String username, String email, List<int> publicKeyBytes)?
      onRegister;
  final List<({String username, String email, List<int> publicKeyBytes})> calls = [];

  @override
  Future<RegisterResult> register(
    String username,
    String email,
    List<int> publicKeyBytes,
  ) async {
    calls.add((username: username, email: email, publicKeyBytes: publicKeyBytes));
    return onRegister?.call(username, email, publicKeyBytes) ??
        RegisterSuccess('fake-user-id');
  }
}
