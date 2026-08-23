/**
 * The docs sidebar per locale, in reading order. Adding a documentation page
 * means adding its route file under `src/routes/docs/` (plus every locale
 * mirror) and one entry per locale here. Entries are literal `as const`
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
        { to: "/docs/plugins/develop", label: "Build a plugin" },
        { to: "/docs/plugins/capabilities", label: "Capabilities" },
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
        { to: "/zh/docs/plugins/develop", label: "构建插件" },
        { to: "/zh/docs/plugins/capabilities", label: "能力与权限" },
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
        { to: "/ja/docs/plugins/develop", label: "プラグインを作る" },
        { to: "/ja/docs/plugins/capabilities", label: "機能と権限" },
        { to: "/ja/docs/plugins/api", label: "APIリファレンス" },
        { to: "/ja/docs/plugins/publishing", label: "公開する" },
      ],
    },
  ],
  fr: [
    {
      title: "Démarrer",
      items: [
        { to: "/fr/docs", label: "Vue d'ensemble", exact: true },
        { to: "/fr/docs/install", label: "Téléchargement et installation" },
        { to: "/fr/docs/getting-started", label: "Démarrage rapide" },
      ],
    },
    {
      title: "Extensions",
      items: [
        { to: "/fr/docs/plugins", label: "Système d'extensions", exact: true },
        { to: "/fr/docs/plugins/develop", label: "Créer une extension" },
        { to: "/fr/docs/plugins/capabilities", label: "Capacités et autorisations" },
        { to: "/fr/docs/plugins/api", label: "Référence de l'API Extension" },
        { to: "/fr/docs/plugins/publishing", label: "Publier une extension" },
      ],
    },
  ],
  de: [
    {
      title: "Start",
      items: [
        { to: "/de/docs", label: "Übersicht", exact: true },
        { to: "/de/docs/install", label: "Download & Installation" },
        { to: "/de/docs/getting-started", label: "Erste Schritte" },
      ],
    },
    {
      title: "Plugins",
      items: [
        { to: "/de/docs/plugins", label: "Plugin-System", exact: true },
        { to: "/de/docs/plugins/develop", label: "Plugin entwickeln" },
        { to: "/de/docs/plugins/capabilities", label: "Funktionen und Rechte" },
        { to: "/de/docs/plugins/api", label: "Plugin-API-Referenz" },
        { to: "/de/docs/plugins/publishing", label: "Ein Plugin veröffentlichen" },
      ],
    },
  ],
  ru: [
    {
      title: "Начало",
      items: [
        { to: "/ru/docs", label: "Обзор", exact: true },
        { to: "/ru/docs/install", label: "Скачать и установить" },
        { to: "/ru/docs/getting-started", label: "Начало работы" },
      ],
    },
    {
      title: "Плагины",
      items: [
        { to: "/ru/docs/plugins", label: "Система плагинов", exact: true },
        { to: "/ru/docs/plugins/develop", label: "Создание плагина" },
        { to: "/ru/docs/plugins/capabilities", label: "Возможности и разрешения" },
        { to: "/ru/docs/plugins/api", label: "Справка по API плагинов" },
        { to: "/ru/docs/plugins/publishing", label: "Публикация плагина" },
      ],
    },
  ],
  es: [
    {
      title: "Inicio",
      items: [
        { to: "/es/docs", label: "Descripción general", exact: true },
        { to: "/es/docs/install", label: "Descarga e instalación" },
        { to: "/es/docs/getting-started", label: "Primeros pasos" },
      ],
    },
    {
      title: "Plugins",
      items: [
        { to: "/es/docs/plugins", label: "Sistema de plugins", exact: true },
        { to: "/es/docs/plugins/develop", label: "Crear un plugin" },
        { to: "/es/docs/plugins/capabilities", label: "Capacidades y permisos" },
        { to: "/es/docs/plugins/api", label: "Referencia API de plugins" },
        { to: "/es/docs/plugins/publishing", label: "Publicar un plugin" },
      ],
    },
  ],
  "zh-hant": [
    {
      title: "開始",
      items: [
        { to: "/zh-hant/docs", label: "總覽", exact: true },
        { to: "/zh-hant/docs/install", label: "下載安裝" },
        { to: "/zh-hant/docs/getting-started", label: "快速上手" },
      ],
    },
    {
      title: "外掛",
      items: [
        { to: "/zh-hant/docs/plugins", label: "外掛系統", exact: true },
        { to: "/zh-hant/docs/plugins/develop", label: "建立外掛" },
        { to: "/zh-hant/docs/plugins/capabilities", label: "能力與權限" },
        { to: "/zh-hant/docs/plugins/api", label: "外掛 API 參考" },
        { to: "/zh-hant/docs/plugins/publishing", label: "發佈外掛" },
      ],
    },
  ],
} as const;
