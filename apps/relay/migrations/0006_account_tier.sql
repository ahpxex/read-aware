-- 账号档位:对外 free / pro / max,内部 staff。账号行只存档位名 + 到期
-- 时间;档位 → 配额的映射住在代码里(src/ports.ts quotasForTier),所以
-- 调配额永远是一次部署,不是一次数据迁移。到期回落 free——数据不删,
-- 超额账号 pull 永远可用,只是 push 被 413 拒(写时执行,读侧无档位)。
-- 写入口是 ADMIN_TOKEN 鉴权的 POST /v1/admin/tier;将来接支付时 webhook
-- 走同一接缝。
ALTER TABLE accounts ADD COLUMN tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE accounts ADD COLUMN tier_expires_at_ms INTEGER;
