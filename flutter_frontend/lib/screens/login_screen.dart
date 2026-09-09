import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../presentation/providers/view_model_provider.dart';
import '../presentation/view_models/auth_viewmodel.dart';
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

  // Swaps in for the sign-in form itself, the same way the web login's
  // "Forgot password?" link swaps its card — one form on screen at a time,
  // rather than a second page to navigate to.
  bool _showForgot = false;
  final _forgotIdentifier = TextEditingController();
  final _forgotPassword = TextEditingController();
  final _forgotConfirm = TextEditingController();
  bool _showForgotPasswords = false;
  bool _forgotSubmitting = false;
  bool _forgotDone = false;
  String? _forgotError;

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    _forgotIdentifier.dispose();
    _forgotPassword.dispose();
    _forgotConfirm.dispose();
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

  void _openForgot() {
    setState(() => _showForgot = true);
  }

  void _closeForgot() {
    setState(() {
      _showForgot = false;
      _forgotIdentifier.clear();
      _forgotPassword.clear();
      _forgotConfirm.clear();
      _forgotError = null;
      _forgotDone = false;
    });
  }

  Future<void> _submitForgot() async {
    FocusScope.of(context).unfocus();
    setState(() => _forgotError = null);

    if (_forgotIdentifier.text.trim().isEmpty) {
      setState(() => _forgotError = 'Enter your phone or email.');
      return;
    }
    if (_forgotPassword.text.length < 8) {
      setState(() => _forgotError = 'New password must be at least 8 characters.');
      return;
    }
    if (_forgotPassword.text != _forgotConfirm.text) {
      setState(() => _forgotError = 'New password and confirmation don’t match.');
      return;
    }

    setState(() => _forgotSubmitting = true);
    try {
      await ref.read(authViewModelProvider.notifier).forgotPassword(
            identifier: _forgotIdentifier.text,
            newPassword: _forgotPassword.text,
          );
      setState(() {
        _forgotSubmitting = false;
        _forgotDone = true;
      });
    } catch (e) {
      setState(() {
        _forgotSubmitting = false;
        _forgotError = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(authViewModelProvider);
    final size = MediaQuery.of(context).size;

    return Scaffold(
      body: Stack(
        children: [
          // Backdrop: a soft accent wash that fades into the page surface,
          // so the sign-in card reads as sitting on something rather than
          // floating on flat grey.
          Container(
            height: size.height * 0.46,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF5A67D8), Color(0xFF7C6FE0)],
              ),
            ),
          ),
          Positioned(
            top: -60,
            right: -40,
            child: _Blob(size: 200, color: Colors.white.withValues(alpha: 0.08)),
          ),
          Positioned(
            top: 40,
            left: -50,
            child: _Blob(size: 140, color: Colors.white.withValues(alpha: 0.07)),
          ),
          SafeArea(
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
                        shadow: AppTheme.elevated,
                        child: _showForgot
                            ? _buildForgot(context)
                            : _buildSignIn(context, state),
                      ),
                      const SizedBox(height: AppTheme.s24),
                      const Center(
                        child: Text(
                          'Trouble signing in? Contact your property owner or admin.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppTheme.muted, fontSize: 12.5),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSignIn(BuildContext context, AuthState state) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Welcome back', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: AppTheme.s4),
        const Text(
          'Use the phone number or email your property gave you.',
          style: TextStyle(color: AppTheme.muted, fontSize: 13),
        ),
        const SizedBox(height: AppTheme.s24),

        // Not labelled "email": the server matches either an email or a
        // phone number, and most of the desk signs in with a number.
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
          labelAction: TextButton(
            onPressed: _openForgot,
            style: TextButton.styleFrom(
              padding: EdgeInsets.zero,
              minimumSize: const Size(0, 0),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text(
              'Forgot password?',
              style: TextStyle(color: AppTheme.accent, fontSize: 12.5),
            ),
          ),
          suffix: _EyeToggle(
            shown: _showPassword,
            onTap: () => setState(() => _showPassword = !_showPassword),
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
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: const [
                    Text('Sign in'),
                    SizedBox(width: AppTheme.s8),
                    Icon(Icons.arrow_forward_rounded, size: 18, color: Colors.white),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _buildForgot(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Reset password', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: AppTheme.s4),
        const Text(
          'Enter the phone or email your property registered with, and choose a new password.',
          style: TextStyle(color: AppTheme.muted, fontSize: 13),
        ),
        const SizedBox(height: AppTheme.s24),

        if (_forgotError != null) ...[
          _ErrorNote(_forgotError!),
          const SizedBox(height: AppTheme.s16),
        ],

        if (_forgotDone)
          Container(
            padding: const EdgeInsets.all(AppTheme.s12),
            decoration: BoxDecoration(
              color: AppTheme.vacant.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(AppTheme.rSmall),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.check_circle_outline, size: 18, color: AppTheme.vacant),
                SizedBox(width: AppTheme.s8),
                Expanded(
                  child: Text(
                    'Password updated. You can sign in with your new password now.',
                    style: TextStyle(color: AppTheme.vacant, fontSize: 13),
                  ),
                ),
              ],
            ),
          )
        else ...[
          NeuField(
            controller: _forgotIdentifier,
            label: 'Phone or email',
            hint: '9876543210',
            keyboardType: TextInputType.emailAddress,
          ),
          const SizedBox(height: AppTheme.s16),
          NeuField(
            controller: _forgotPassword,
            label: 'New password',
            obscure: !_showForgotPasswords,
            suffix: _EyeToggle(
              shown: _showForgotPasswords,
              onTap: () => setState(() => _showForgotPasswords = !_showForgotPasswords),
            ),
          ),
          const SizedBox(height: AppTheme.s16),
          NeuField(
            controller: _forgotConfirm,
            label: 'Confirm new password',
            obscure: !_showForgotPasswords,
            suffix: _EyeToggle(
              shown: _showForgotPasswords,
              onTap: () => setState(() => _showForgotPasswords = !_showForgotPasswords),
            ),
          ),
        ],

        const SizedBox(height: AppTheme.s16),
        Row(
          children: [
            Expanded(
              child: NeuButton(
                onPressed: _forgotSubmitting ? null : _closeForgot,
                child: Text(_forgotDone ? 'Back to sign in' : 'Cancel'),
              ),
            ),
            if (!_forgotDone) ...[
              const SizedBox(width: AppTheme.s12),
              Expanded(
                child: NeuButton(
                  primary: true,
                  onPressed: _forgotSubmitting ? null : _submitForgot,
                  child: _forgotSubmitting
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Text('Reset password'),
                ),
              ),
            ],
          ],
        ),
      ],
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
        Container(
          width: 84,
          height: 84,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Colors.white, Color(0xFFF4F3FF)],
            ),
            boxShadow: AppTheme.elevated,
          ),
          child: const Icon(Icons.hotel_rounded, size: 40, color: AppTheme.accent),
        ),
        const SizedBox(height: AppTheme.s16),
        Text(
          'Front desk',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.white),
        ),
        const SizedBox(height: AppTheme.s4),
        const Text(
          'Hotel Management',
          style: TextStyle(color: Colors.white70, fontSize: 13, letterSpacing: 0.4),
        ),
      ],
    );
  }
}

class _Blob extends StatelessWidget {
  final double size;
  final Color color;

  const _Blob({required this.size, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(shape: BoxShape.circle, color: color),
    );
  }
}

/// The eye/eye-off toggle living inside the field's own well, the same spot
/// the web login's `field__input-wrap` puts it — not a separate button
/// underneath the field.
class _EyeToggle extends StatelessWidget {
  final bool shown;
  final VoidCallback onTap;

  const _EyeToggle({required this.shown, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap,
      icon: Icon(
        shown ? Icons.visibility_off_outlined : Icons.visibility_outlined,
        size: 19,
        color: AppTheme.muted,
      ),
      splashRadius: 18,
      tooltip: shown ? 'Hide password' : 'Show password',
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
          const Icon(Icons.error_outline, size: 18, color: AppTheme.danger),
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
