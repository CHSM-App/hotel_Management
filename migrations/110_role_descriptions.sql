-- Role descriptions brought in line with how orders now flow. Only rows still
-- carrying the original wording are touched, so a description an owner has
-- edited is left alone. Permissions are not changed.
UPDATE dbo.roles SET description = 'Front desk — bookings, check-in/out, billing, the guest register and food orders.'
WHERE lodge_id IS NULL AND role_key = 'RECEPTION'
  AND description = 'Front desk — bookings, check-in/out, billing and the guest register.';

UPDATE dbo.roles SET description = 'Kitchen — sees the live queue, starts cooking and marks orders ready. Cannot take, cancel or deliver orders.'
WHERE lodge_id IS NULL AND role_key = 'KITCHEN' AND description = 'Food orders only.';

UPDATE dbo.roles SET description = 'Floor — takes orders, accepts guest QR orders, edits, cancels, returns and delivers dishes until billed.'
WHERE lodge_id IS NULL AND role_key = 'CAPTAIN' AND description = 'Takes orders from tables and rooms.';

UPDATE dbo.roles SET description = 'Billing, payments, expenses, income and profit & loss.'
WHERE lodge_id IS NULL AND role_key = 'ACCOUNTANT' AND description = 'Billing, payments and property expenses.';
GO
