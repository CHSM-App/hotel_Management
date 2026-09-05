const { z } = require('zod');

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your phone or email.'),
  password: z.string().min(1, 'Enter your password.'),
});

const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your phone or email.'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.'),
});

module.exports = { loginSchema, forgotPasswordSchema };
