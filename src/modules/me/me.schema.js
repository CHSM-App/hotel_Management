const { z } = require('zod');

const currentPassword = z
  .string({ error: 'Enter your current password.' })
  .min(1, 'Enter your current password.');

// Step 1 asks only for the current password: the new one is not collected until
// the code has arrived, so there is nothing to validate about it yet.
const sendPasswordOtpSchema = z.object({ currentPassword });

const changePasswordSchema = z.object({
  currentPassword,
  newPassword: z
    .string({ error: 'Enter a new password.' })
    .min(8, 'New password must be at least 8 characters.'),
  // Exactly six digits. Trimmed first because the code arrives by WhatsApp and
  // gets pasted with whitespace around it more often than not.
  otp: z
    .string({ error: 'Enter the code sent to your phone.' })
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code sent to your phone.'),
});

module.exports = { changePasswordSchema, sendPasswordOtpSchema };
