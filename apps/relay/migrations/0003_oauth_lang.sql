-- OAuth 完成页要用发起端的界面语言渲染，而 callback 手里只有 state ——
-- 所以语言随 state 一起落库（start 时客户端带 ?lang=），consume 时取回。
ALTER TABLE oauth_states ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
