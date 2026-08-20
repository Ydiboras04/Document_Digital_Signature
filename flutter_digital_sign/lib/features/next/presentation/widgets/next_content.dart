import 'package:flutter/material.dart';

import '../pages/document_details_page.dart';

class NextContent extends StatefulWidget {
  const NextContent({super.key});

  @override
  State<NextContent> createState() => _NextContentState();
}

class _NextContentState extends State<NextContent> {
  final documents = [
    'Contract_Proposal.pdf',
    'Invoice_2026_08.pdf',
    'Employment_Agreement.pdf',
    'Confidentiality_Notice.pdf',
  ];

  String? selectedDocument;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Documents',
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Choose a PDF to sign later.',
            style: TextStyle(fontSize: 16, color: Colors.grey),
          ),
          const SizedBox(height: 20),
          Expanded(
            child: ListView.separated(
              itemCount: documents.length,
              separatorBuilder: (context, index) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final document = documents[index];
                final isSelected = selectedDocument == document;

                return Card(
                  elevation: isSelected ? 2 : 1,
                  color: isSelected ? Colors.blue.shade50 : null,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                    side: isSelected
                        ? const BorderSide(color: Colors.blue, width: 1.5)
                        : BorderSide.none,
                  ),
                  child: ListTile(
                    leading: Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: Colors.red.shade50,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(
                        Icons.picture_as_pdf,
                        color: Colors.red,
                      ),
                    ),
                    title: Text(document),
                    subtitle: Text(
                      isSelected ? 'Selected for signing' : 'Ready for signature',
                    ),
                    trailing: const Icon(Icons.arrow_forward_ios, size: 16),
                    onTap: () {
                      setState(() {
                        selectedDocument = document;
                      });

                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => DocumentDetailsPage(
                            documentName: document,
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
