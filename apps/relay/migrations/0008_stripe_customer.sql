-- 计费:账号 ↔ Stripe customer 的映射。checkout.session.completed 时写入,
-- 之后订阅生命周期事件(updated/deleted)靠它反查账号。一个账号一个
-- customer;webhook 是唯一写入方,tier 的变更走与 admin 相同的写入接缝。
ALTER TABLE accounts ADD COLUMN stripe_customer_id TEXT;
CREATE INDEX IF NOT EXISTS ix_accounts_stripe_customer ON accounts (stripe_customer_id);
