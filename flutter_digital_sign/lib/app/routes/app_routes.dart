import 'package:flutter/material.dart';

import '../../features/register/presentation/pages/register_page.dart';
import '../../features/next/presentation/pages/document_details_page.dart';
import '../../features/next/presentation/pages/next_page.dart';
import '../../features/next/presentation/pages/signing_confirmation_page.dart';
import '../../features/welcome/presentation/pages/welcome_page.dart';

class AppRoutes {
  static const String welcome = '/';
  static const String register = '/register';
  static const String next = '/next';
  static const String documentDetails = '/document-details';
  static const String signingConfirmation = '/signing-confirmation';

  static Map<String, WidgetBuilder> get routes => {
        welcome: (context) => const WelcomePage(),
        register: (context) => const RegisterPage(),
        next: (context) => const NextPage(),
      };

  static Route<dynamic> generateRoute(RouteSettings settings) {
    switch (settings.name) {
      case welcome:
        return MaterialPageRoute(builder: (_) => const WelcomePage());
      case register:
        return MaterialPageRoute(builder: (_) => const RegisterPage());
      case next:
        return MaterialPageRoute(builder: (_) => const NextPage());
      case documentDetails:
        final args = settings.arguments as Map<String, String>? ?? {};
        final documentName = args['documentName'] ?? 'Document.pdf';
        return MaterialPageRoute(
          builder: (_) => DocumentDetailsPage(documentName: documentName),
        );
      case signingConfirmation:
        final args = settings.arguments as Map<String, String>? ?? {};
        final documentName = args['documentName'] ?? 'Document.pdf';
        return MaterialPageRoute(
          builder: (_) => SigningConfirmationPage(documentName: documentName),
        );
      default:
        return MaterialPageRoute(builder: (_) => const WelcomePage());
    }
  }
}
