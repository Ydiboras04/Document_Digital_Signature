import 'package:flutter/material.dart';

import '../widgets/welcome_content.dart';

class WelcomePage extends StatelessWidget {
  const WelcomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: WelcomeContent(),
    );
  }
}
