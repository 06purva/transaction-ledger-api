-- This is an empty migration.


ALTER TABLE "accounts"
ADD CONSTRAINT "accounts_balance_nonnegative"
CHECK ("balance" >= 0);

ALTER TABLE "transactions"
ADD CONSTRAINT "transactions_amount_positive"
CHECK ("amount" > 0);
