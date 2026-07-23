/**
 * The docs sidebar per locale, in reading order. Adding a documentation page
 * means adding its route file under `src/routes/docs/` (plus the `/zh` and
 * `/ja` mirrors) and one entry per locale here. Entries are literal `as const`
 * paths so links stay type-checked against the route tree.
 *
 * `exact` marks section-index pages ("/docs", "/docs/plugins") so they don't
 * light up while one of their children is open.
 */
export const DOCS_NAV = {
  en: [
    {
      title: "Start",
      items: [
        { to: "/docs", label: "Overview", exact: true },
        { to: "/docs/install", label: "Download & install" },
        { to: "/docs/getting-started", label: "Getting started" },
      ],
    },
    {
      title: "Plugins",
      items: [
        { to: "/docs/plugins", label: "Plugin system", exact: true },
        { to: "/docs/plugins/api", label: "API reference" },
        { to: "/docs/plugins/publishing", label: "Publishing" },
      ],
    },
  ],
  zh: [
    {
      title: "开始",
      items: [
        { to: "/zh/docs", label: "总览", exact: true },
        { to: "/zh/docs/install", label: "下载安装" },
        { to: "/zh/docs/getting-started", label: "快速上手" },
      ],
    },
    {
      title: "插件",
      items: [
        { to: "/zh/docs/plugins", label: "插件系统", exact: true },
        { to: "/zh/docs/plugins/api", label: "API 参考" },
        { to: "/zh/docs/plugins/publishing", label: "发布上架" },
      ],
    },
  ],
  ja: [
    {
      title: "はじめに",
      items: [
        { to: "/ja/docs", label: "概要", exact: true },
        { to: "/ja/docs/install", label: "ダウンロードとインストール" },
        { to: "/ja/docs/getting-started", label: "使いはじめる" },
      ],
    },
    {
      title: "プラグイン",
      items: [
        { to: "/ja/docs/plugins", label: "プラグインシステム", exact: true },
        { to: "/ja/docs/plugins/api", label: "APIリファレンス" },
        { to: "/ja/docs/plugins/publishing", label: "公開する" },
      ],
    },
  ],
} as const;
