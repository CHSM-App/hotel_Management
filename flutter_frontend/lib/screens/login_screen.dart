import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../presentation/providers/view_model_provider.dart';
import '../widgets/neu.dart';
import 'theme.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _showPassword = false;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    final ok = await ref
        .read(authViewModelProvider.notifier)
        .login(_identifier.text, _password.text);
    // The shell watches the session and swaps itself in on success, so there is
    // nothing to navigate to from here.
    if (ok) _password.clear();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authViewModelProvider);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppTheme.s24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _Mark(),
                  const SizedBox(height: AppTheme.s32),
                  NeuCard(
                    radius: AppTheme.rLarge,
                    padding: const EdgeInsets.all(AppTheme.s24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'Sign in',
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: AppTheme.s4),
                        const Text(
                          'Use the phone number or email your property gave you.',
                          style: TextStyle(
                            color: AppTheme.muted,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: AppTheme.s24),

                        // Not labelled "email": the server matches either an
                        // email or a phone number, and most of the desk signs
                        // in with a number.
                        NeuField(
                          controller: _identifier,
                          label: 'Phone or email',
                          hint: '9876543210',
                          keyboardType: TextInputType.emailAddress,
                        ),
                        const SizedBox(height: AppTheme.s16),
                        NeuField(
                          controller: _password,
                          label: 'Password',
                          obscure: !_showPassword,
                        ),
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(
                            onPressed: () => setState(
                              () => _showPassword = !_showPassword,
                            ),
                            child: Text(
                              _showPassword ? 'Hide password' : 'Show password',
                              style: const TextStyle(
                                color: AppTheme.accent,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ),

                        if (state.error != null) ...[
                          const SizedBox(height: AppTheme.s8),
                          _ErrorNote(state.error!),
                        ],

                        const SizedBox(height: AppTheme.s16),
                        NeuButton(
                          primary: true,
                          expand: true,
                          onPressed: state.isLoading ? null : _submit,
                          child: state.isLoading
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Text('Sign in'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ── Masthead ────────────────────────────────────────────────────────────────

class _Mark extends StatelessWidget {
  const _Mark();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        NeuCard(
          radius: AppTheme.rLarge,
          padding: const EdgeInsets.all(AppTheme.s24),
          child: const Icon(
            Icons.hotel_rounded,
            size: 40,
            color: AppTheme.accent,
          ),
        ),
        const SizedBox(height: AppTheme.s16),
        Text('Front desk', style: Theme.of(context).textTheme.headlineSmall),
      ],
    );
  }
}

class _ErrorNote extends StatelessWidget {
  final String message;

  const _ErrorNote(this.message);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.s12),
      decoration: BoxDecoration(
        color: AppTheme.danger.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppTheme.rSmall),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.error_outline,
            size: 18,
            color: AppTheme.danger,
          ),
          const SizedBox(width: AppTheme.s8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: AppTheme.danger, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}
