const { z } = require('zod');

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your phone or email.'),
  password: z.string().min(1, 'Enter your password.'),
});

module.exports = { loginSchema };
