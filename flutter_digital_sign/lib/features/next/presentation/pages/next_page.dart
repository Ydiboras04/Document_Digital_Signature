import 'package:flutter/material.dart';

import '../widgets/next_content.dart';

class NextPage extends StatelessWidget {
  const NextPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Digital Signature'),
      ),
      body: const NextContent(),
    );
  }
}
