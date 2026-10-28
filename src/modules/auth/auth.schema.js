const { z } = require('zod');

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your phone or email.'),
  password: z.string().min(1, 'Enter your password.'),
});

const sendForgotPasswordOtpSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your phone or email.'),
});

const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your phone or email.'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.'),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code sent to your phone.'),
});

module.exports = { loginSchema, sendForgotPasswordOtpSchema, forgotPasswordSchema };
