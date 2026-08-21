import 'package:flutter_digital_sign/core/network/auth_api.dart';

class FakeAuthApi implements AuthApi {
  List<int> Function(String userId)? onRequestChallenge;
  String Function(String userId, List<int> signature)? onExchangeForToken;

  final List<String> challengeCalls = [];
  final List<({String userId, List<int> signature})> tokenCalls = [];

  @override
  Future<List<int>> requestChallenge(String userId) async {
    challengeCalls.add(userId);
    return onRequestChallenge?.call(userId) ?? List<int>.filled(32, 3);
  }

  @override
  Future<String> exchangeForToken(String userId, List<int> signature) async {
    tokenCalls.add((userId: userId, signature: signature));
    return onExchangeForToken?.call(userId, signature) ?? 'fake-token';
  }
}
