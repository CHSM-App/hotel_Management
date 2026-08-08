const { z } = require('zod');

const changePasswordSchema = z.object({
  currentPassword: z.string({ error: 'Enter your current password.' }).min(1, 'Enter your current password.'),
  newPassword: z
    .string({ error: 'Enter a new password.' })
    .min(8, 'New password must be at least 8 characters.'),
});

module.exports = { changePasswordSchema };
