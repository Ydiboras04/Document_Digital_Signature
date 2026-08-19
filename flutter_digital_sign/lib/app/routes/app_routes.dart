import 'package:flutter/material.dart';

import '../../features/login/presentation/pages/login_page.dart';
import '../../features/next/presentation/pages/next_page.dart';
import '../../features/welcome/presentation/pages/welcome_page.dart';

class AppRoutes {
  static const String welcome = '/';
  static const String login = '/login';
  static const String next = '/next';

  static Map<String, WidgetBuilder> get routes => {
        welcome: (context) => const WelcomePage(),
        login: (context) => const LoginPage(),
        next: (context) => const NextPage(),
      };

  static Route<dynamic> generateRoute(RouteSettings settings) {
    switch (settings.name) {
      case welcome:
        return MaterialPageRoute(builder: (_) => const WelcomePage());
      case login:
        return MaterialPageRoute(builder: (_) => const LoginPage());
      case next:
        return MaterialPageRoute(builder: (_) => const NextPage());
      default:
        return MaterialPageRoute(
          builder: (_) => const WelcomePage(),
        );
    }
  }
}
