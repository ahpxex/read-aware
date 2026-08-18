-- Bundled-AI 计量:按「账号 × 自然月(UTC)」聚合一行,记 micro-USD 成本
-- (1 credit = 1000 µ$ = $0.001,换算在代码里)。只增不减、月度自然翻篇
-- (新月新行),所以没有重置作业。请求内容永远不落库——这张表只有数字。
CREATE TABLE IF NOT EXISTS ai_usage (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month      TEXT NOT NULL, -- 'YYYY-MM' (UTC)
  micro_usd  INTEGER NOT NULL DEFAULT 0,
  requests   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, month)
);
