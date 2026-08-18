/**
 * The pricing page's content registry — like the changelog, every word lives
 * here so the locale routes stay three-line wrappers. Numbers mirror the
 * relay's tier table (apps/relay/src/ports.ts quotasForTier; pricing decided
 * 2026-08-19): free / sync $5 / pro $20 / max $50, AI credits 0 / 0 / 5,000 /
 * 30,000, storage 50 MB / 10 GB / 10 GB / 100 GB. Change the ladder there
 * first, then here.
 */
import type { Locale } from "./i18n";

export type PricingPlan = {
  id: "free" | "sync" | "pro" | "max";
  name: string;
  /** Rendered big; free carries "$0" so the row scans as one ladder. */
  price: string;
  tagline: string;
  features: string[];
  /** The plan the page quietly recommends (one per locale set). */
  highlight?: boolean;
};

export type PricingCopy = {
  title: string;
  lead: string;
  perMonth: string;
  recommended: string;
  /** The free plan's card action — the download anchor on the homepage. */
  ctaFree: string;
  /** Paid cards' checkout button. */
  ctaPaid: string;
  /** Shown while the checkout session is being minted. */
  ctaPaidBusy: string;
  /** Banner after Stripe redirects back with ?purchase=success. */
  purchaseSuccess: string;
  /** Under the grid when minting a checkout session failed. */
  checkoutFailed: string;
  /** Shared support line under the grid. */
  paidNote: string;
  paidNoteLink: string;
  finePrintTitle: string;
  finePrint: string[];
  plans: PricingPlan[];
};

export const PRICING: Record<Locale, PricingCopy> = {
  en: {
    title: "Pricing",
    lead: "The app is free and complete on its own — every reader feature, your own AI key, your data on your disk. Paid plans add encrypted sync and built-in AI, priced so a subscription is never the thing between you and your library.",
    perMonth: "/month",
    recommended: "Recommended",
    ctaFree: "Download for free",
    ctaPaid: "Subscribe",
    ctaPaidBusy: "Opening checkout…",
    purchaseSuccess: "Payment received — your plan is active. Sign in to the app with the email you used at checkout.",
    checkoutFailed: "Couldn't start checkout. Try again, or write to us.",
    paidNote: "Questions about billing?",
    paidNoteLink: "Write to us",
    finePrintTitle: "The fine print, in plain words",
    finePrint: [
      "AI credits: 1 credit = $0.001 of model usage at list price. A typical question costs 2–4 credits, so 5,000 credits is roughly a thousand conversations. Credits reset monthly.",
      "Bring-your-own-key AI is free forever, on every plan — the subscription is a convenience, not a wall.",
      "Synced data is end-to-end encrypted. The server stores ciphertext it cannot read; the passphrase never leaves your devices.",
      "Built-in AI requests pass through our relay to the model provider over TLS and are never logged or stored — only token counts are metered. If that trade-off isn't for you, use your own key.",
      "Downgrading never deletes anything. Over-quota accounts keep reading and downloading their data; only new uploads pause.",
    ],
    plans: [
      {
        id: "free",
        name: "Free",
        price: "$0",
        tagline: "The whole reading app, no account needed.",
        features: [
          "Every reader feature — EPUB, PDF, MOBI and more",
          "AI chat and memory with your own API key",
          "All data local, on your disk",
          "50 MB encrypted sync to try multi-device",
        ],
      },
      {
        id: "sync",
        name: "Sync",
        price: "$5",
        tagline: "Your library on every device. You bring the AI key.",
        features: [
          "10 GB end-to-end-encrypted sync",
          "Whole library, annotations, progress, memory",
          "Unlimited devices",
          "Bring your own AI key",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: "$20",
        tagline: "Sync plus built-in AI — nothing to configure.",
        highlight: true,
        features: [
          "Everything in Sync",
          "Built-in AI, no key setup",
          "5,000 AI credits a month — about a thousand conversations",
          "DeepSeek V4 Flash and V4 Pro models",
        ],
      },
      {
        id: "max",
        name: "Max",
        price: "$50",
        tagline: "For heavy readers and big libraries.",
        features: [
          "Everything in Pro",
          "30,000 AI credits a month",
          "100 GB encrypted sync",
          "First in line for new AI models",
        ],
      },
    ],
  },
  zh: {
    title: "定价",
    lead: "应用本身免费且完整——全部阅读功能、自带 AI key、数据在你自己的磁盘上。付费方案加的是加密同步和内置 AI,定价的原则是:订阅永远不该挡在你和你的书之间。",
    perMonth: "/月",
    recommended: "推荐",
    ctaFree: "免费下载",
    ctaPaid: "订阅",
    ctaPaidBusy: "正在打开支付页…",
    purchaseSuccess: "支付成功——方案已生效。用你结账时填的邮箱登录应用即可。",
    checkoutFailed: "无法发起支付,请重试,或写邮件给我们。",
    paidNote: "对账单有疑问?",
    paidNoteLink: "写邮件给我们",
    finePrintTitle: "细则,说人话",
    finePrint: [
      "AI credits:1 credit = $0.001 的模型用量(按牌价)。一次典型提问花 2–4 credits,5,000 credits 约等于一千次对话。每月重置。",
      "自带 key 的 AI 永远免费、每个方案都可用——订阅是省事,不是围墙。",
      "同步数据端到端加密。服务器只存它读不懂的密文;口令永远不离开你的设备。",
      "内置 AI 的请求经我们的中继转发给模型服务商(TLS 加密),永不记录、永不存储——只计量 token 数。不接受这个取舍,就用自己的 key。",
      "降级永远不删数据。超出配额的账号照常阅读、照常下载,只是暂停新的上传。",
    ],
    plans: [
      {
        id: "free",
        name: "免费",
        price: "$0",
        tagline: "完整的阅读应用,无需账号。",
        features: [
          "全部阅读功能——EPUB、PDF、MOBI 等",
          "自带 API key 即可用 AI 对话与记忆",
          "所有数据都在你自己的磁盘上",
          "50 MB 加密同步额度,体验多设备",
        ],
      },
      {
        id: "sync",
        name: "Sync",
        price: "$5",
        tagline: "书库同步到每台设备,AI key 自带。",
        features: [
          "10 GB 端到端加密同步",
          "整个书库、标注、进度、记忆",
          "设备数量不限",
          "AI 用自己的 key",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: "$20",
        tagline: "同步 + 内置 AI,什么都不用配。",
        highlight: true,
        features: [
          "包含 Sync 的全部内容",
          "内置 AI,无需配置 key",
          "每月 5,000 AI credits——约一千次对话",
          "DeepSeek V4 Flash 与 V4 Pro 模型",
        ],
      },
      {
        id: "max",
        name: "Max",
        price: "$50",
        tagline: "给重度读者和大书库。",
        features: [
          "包含 Pro 的全部内容",
          "每月 30,000 AI credits",
          "100 GB 加密同步",
          "新模型优先体验",
        ],
      },
    ],
  },
  "zh-hant": {
    title: "定價",
    lead: "應用本身免費且完整——全部閱讀功能、自帶 AI key、資料在你自己的磁碟上。付費方案加的是加密同步和內建 AI,定價的原則是:訂閱永遠不該擋在你和你的書之間。",
    perMonth: "/月",
    recommended: "推薦",
    ctaFree: "免費下載",
    ctaPaid: "訂閱",
    ctaPaidBusy: "正在開啟付款頁…",
    purchaseSuccess: "付款成功——方案已生效。用你結帳時填的信箱登入應用即可。",
    checkoutFailed: "無法發起付款,請重試,或寫信給我們。",
    paidNote: "對帳單有疑問?",
    paidNoteLink: "寫信給我們",
    finePrintTitle: "細則,說白話",
    finePrint: [
      "AI credits:1 credit = $0.001 的模型用量(按牌價)。一次典型提問花 2–4 credits,5,000 credits 約等於一千次對話。每月重置。",
      "自帶 key 的 AI 永遠免費、每個方案都可用——訂閱是省事,不是圍牆。",
      "同步資料端到端加密。伺服器只存它讀不懂的密文;通行短語永遠不離開你的裝置。",
      "內建 AI 的請求經我們的中繼轉發給模型服務商(TLS 加密),永不記錄、永不儲存——只計量 token 數。不接受這個取捨,就用自己的 key。",
      "降級永遠不刪資料。超出配額的帳號照常閱讀、照常下載,只是暫停新的上傳。",
    ],
    plans: [
      {
        id: "free",
        name: "免費",
        price: "$0",
        tagline: "完整的閱讀應用,無需帳號。",
        features: [
          "全部閱讀功能——EPUB、PDF、MOBI 等",
          "自帶 API key 即可用 AI 對話與記憶",
          "所有資料都在你自己的磁碟上",
          "50 MB 加密同步額度,體驗多裝置",
        ],
      },
      {
        id: "sync",
        name: "Sync",
        price: "$5",
        tagline: "書庫同步到每台裝置,AI key 自帶。",
        features: [
          "10 GB 端到端加密同步",
          "整個書庫、標註、進度、記憶",
          "裝置數量不限",
          "AI 用自己的 key",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: "$20",
        tagline: "同步 + 內建 AI,什麼都不用設定。",
        highlight: true,
        features: [
          "包含 Sync 的全部內容",
          "內建 AI,無需設定 key",
          "每月 5,000 AI credits——約一千次對話",
          "DeepSeek V4 Flash 與 V4 Pro 模型",
        ],
      },
      {
        id: "max",
        name: "Max",
        price: "$50",
        tagline: "給重度讀者和大書庫。",
        features: [
          "包含 Pro 的全部內容",
          "每月 30,000 AI credits",
          "100 GB 加密同步",
          "新模型優先體驗",
        ],
      },
    ],
  },
  ja: {
    title: "料金",
    lead: "アプリ本体は無料で、それだけで完結しています——すべての読書機能、ご自身の AI キー、データはあなたのディスクに。有料プランが加えるのは暗号化同期と内蔵 AI。サブスクリプションがあなたと本のあいだに立ちはだからないこと、それが価格設計の原則です。",
    perMonth: "/月",
    recommended: "おすすめ",
    ctaFree: "無料でダウンロード",
    ctaPaid: "申し込む",
    ctaPaidBusy: "チェックアウトを開いています…",
    purchaseSuccess: "お支払いが完了しました——プランが有効になりました。チェックアウト時のメールアドレスでアプリにサインインしてください。",
    checkoutFailed: "チェックアウトを開始できませんでした。もう一度お試しいただくか、メールでご連絡ください。",
    paidNote: "料金についてのご質問は",
    paidNoteLink: "メールでお問い合わせください",
    finePrintTitle: "細かい条件を、わかりやすく",
    finePrint: [
      "AI クレジット:1 クレジット = 定価換算 $0.001 のモデル利用量。標準的な質問 1 回で 2〜4 クレジット、5,000 クレジットはおよそ千回の対話に相当します。毎月リセットされます。",
      "自分のキーを使う AI はどのプランでも永久に無料——サブスクリプションは利便性であって、壁ではありません。",
      "同期データはエンドツーエンドで暗号化。サーバーが保存するのは読めない暗号文だけで、パスフレーズが端末の外に出ることはありません。",
      "内蔵 AI のリクエストは当社の中継サーバー経由でモデル提供元へ TLS 送信され、記録も保存も一切されません——計測されるのはトークン数のみ。この前提が合わない場合はご自身のキーをお使いください。",
      "ダウングレードでデータが消えることはありません。容量超過のアカウントも閲覧とダウンロードはそのまま、新しいアップロードだけが一時停止します。",
    ],
    plans: [
      {
        id: "free",
        name: "無料",
        price: "$0",
        tagline: "アカウント不要の、完全な読書アプリ。",
        features: [
          "すべての読書機能——EPUB、PDF、MOBI など",
          "ご自身の API キーで AI 対話とメモリー",
          "データはすべて自分のディスクに",
          "50 MB の暗号化同期でマルチデバイスを体験",
        ],
      },
      {
        id: "sync",
        name: "Sync",
        price: "$5",
        tagline: "全デバイスにライブラリを同期。AI キーはご自身で。",
        features: [
          "10 GB のエンドツーエンド暗号化同期",
          "ライブラリ・注釈・進捗・メモリーを丸ごと",
          "デバイス数無制限",
          "AI はご自身のキーで",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: "$20",
        tagline: "同期に内蔵 AI をプラス。設定は不要。",
        highlight: true,
        features: [
          "Sync のすべてを含む",
          "内蔵 AI、キー設定不要",
          "毎月 5,000 AI クレジット——約千回の対話",
          "DeepSeek V4 Flash / V4 Pro モデル",
        ],
      },
      {
        id: "max",
        name: "Max",
        price: "$50",
        tagline: "ヘビーリーダーと大きなライブラリのために。",
        features: [
          "Pro のすべてを含む",
          "毎月 30,000 AI クレジット",
          "100 GB の暗号化同期",
          "新モデルへの優先アクセス",
        ],
      },
    ],
  },
  fr: {
    title: "Tarifs",
    lead: "L'application est gratuite et complète en elle-même — toutes les fonctions de lecture, votre propre clé d'IA, vos données sur votre disque. Les offres payantes ajoutent la synchronisation chiffrée et l'IA intégrée, avec un principe : l'abonnement ne doit jamais se dresser entre vous et votre bibliothèque.",
    perMonth: "/mois",
    recommended: "Recommandée",
    ctaFree: "Télécharger gratuitement",
    ctaPaid: "S'abonner",
    ctaPaidBusy: "Ouverture du paiement…",
    purchaseSuccess: "Paiement reçu — votre offre est active. Connectez-vous à l'application avec l'e-mail utilisé lors du paiement.",
    checkoutFailed: "Impossible de démarrer le paiement. Réessayez ou écrivez-nous.",
    paidNote: "Des questions sur la facturation ?",
    paidNoteLink: "Écrivez-nous",
    finePrintTitle: "Les petites lignes, en clair",
    finePrint: [
      "Crédits IA : 1 crédit = 0,001 $ d'usage du modèle au tarif public. Une question typique coûte 2 à 4 crédits ; 5 000 crédits représentent environ mille conversations. Remise à zéro chaque mois.",
      "L'IA avec votre propre clé reste gratuite pour toujours, sur chaque offre — l'abonnement est un confort, pas un mur.",
      "Les données synchronisées sont chiffrées de bout en bout. Le serveur ne stocke qu'un chiffrement illisible ; la phrase secrète ne quitte jamais vos appareils.",
      "Les requêtes de l'IA intégrée transitent par notre relais vers le fournisseur du modèle en TLS et ne sont jamais journalisées ni stockées — seuls les décomptes de tokens sont mesurés. Si ce compromis ne vous convient pas, utilisez votre propre clé.",
      "Rétrograder ne supprime jamais rien. Un compte au-dessus du quota continue de lire et de télécharger ses données ; seuls les nouveaux envois sont suspendus.",
    ],
    plans: [
      {
        id: "free",
        name: "Gratuite",
        price: "0 $",
        tagline: "Toute l'application de lecture, sans compte.",
        features: [
          "Toutes les fonctions de lecture — EPUB, PDF, MOBI et plus",
          "Dialogue et mémoire IA avec votre propre clé API",
          "Toutes les données en local, sur votre disque",
          "50 Mo de synchronisation chiffrée pour essayer le multi-appareils",
        ],
      },
      {
        id: "sync",
        name: "Sync",
        price: "5 $",
        tagline: "Votre bibliothèque sur chaque appareil. La clé d'IA est la vôtre.",
        features: [
          "10 Go de synchronisation chiffrée de bout en bout",
          "Bibliothèque, annotations, progression, mémoire",
          "Appareils illimités",
          "IA avec votre propre clé",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: "20 $",
        tagline: "La synchronisation plus l'IA intégrée — rien à configurer.",
        highlight: true,
        features: [
          "Tout ce que contient Sync",
          "IA intégrée, aucune clé à configurer",
          "5 000 crédits IA par mois — environ mille conversations",
          "Modèles DeepSeek V4 Flash et V4 Pro",
        ],
      },
      {
        id: "max",
        name: "Max",
        price: "50 $",
        tagline: "Pour les grands lecteurs et les grandes bibliothèques.",
        features: [
          "Tout ce que contient Pro",
          "30 000 crédits IA par mois",
          "100 Go de synchronisation chiffrée",
          "Accès prioritaire aux nouveaux modèles",
        ],
      },
    ],
  },
  de: {
    title: "Preise",
    lead: "Die App ist kostenlos und für sich vollständig — alle Lesefunktionen, dein eigener KI-Schlüssel, deine Daten auf deiner Festplatte. Bezahlte Tarife fügen verschlüsselte Synchronisation und integrierte KI hinzu, nach einem Prinzip: Ein Abo darf nie zwischen dir und deiner Bibliothek stehen.",
    perMonth: "/Monat",
    recommended: "Empfohlen",
    ctaFree: "Kostenlos herunterladen",
    ctaPaid: "Abonnieren",
    ctaPaidBusy: "Checkout wird geöffnet…",
    purchaseSuccess: "Zahlung eingegangen — dein Tarif ist aktiv. Melde dich in der App mit der E-Mail-Adresse aus dem Checkout an.",
    checkoutFailed: "Der Checkout konnte nicht gestartet werden. Versuche es erneut oder schreib uns.",
    paidNote: "Fragen zur Abrechnung?",
    paidNoteLink: "Schreib uns",
    finePrintTitle: "Das Kleingedruckte, klar gesagt",
    finePrint: [
      "KI-Credits: 1 Credit = 0,001 $ Modellnutzung zum Listenpreis. Eine typische Frage kostet 2–4 Credits; 5.000 Credits sind rund tausend Gespräche. Monatlicher Reset.",
      "KI mit eigenem Schlüssel bleibt für immer kostenlos, in jedem Tarif — das Abo ist Bequemlichkeit, keine Mauer.",
      "Synchronisierte Daten sind Ende-zu-Ende-verschlüsselt. Der Server speichert nur unlesbaren Geheimtext; die Passphrase verlässt deine Geräte nie.",
      "Anfragen der integrierten KI laufen über unser Relay per TLS zum Modellanbieter und werden nie protokolliert oder gespeichert — gemessen werden nur Token-Zahlen. Wenn dir dieser Kompromiss nicht passt, nimm deinen eigenen Schlüssel.",
      "Ein Downgrade löscht niemals etwas. Konten über dem Kontingent lesen und laden weiter; nur neue Uploads pausieren.",
    ],
    plans: [
      {
        id: "free",
        name: "Kostenlos",
        price: "0 $",
        tagline: "Die ganze Lese-App, ohne Konto.",
        features: [
          "Alle Lesefunktionen — EPUB, PDF, MOBI und mehr",
          "KI-Chat und Gedächtnis mit eigenem API-Schlüssel",
          "Alle Daten lokal, auf deiner Festplatte",
          "50 MB verschlüsselte Synchronisation zum Ausprobieren",
        ],
      },
      {
        id: "sync",
        name: "Sync",
        price: "5 $",
        tagline: "Deine Bibliothek auf jedem Gerät. Den KI-Schlüssel bringst du mit.",
        features: [
          "10 GB Ende-zu-Ende-verschlüsselte Synchronisation",
          "Ganze Bibliothek, Anmerkungen, Fortschritt, Gedächtnis",
          "Unbegrenzt viele Geräte",
          "KI mit eigenem Schlüssel",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: "20 $",
        tagline: "Synchronisation plus integrierte KI — nichts zu konfigurieren.",
        highlight: true,
        features: [
          "Alles aus Sync",
          "Integrierte KI, keine Schlüssel-Einrichtung",
          "5.000 KI-Credits im Monat — rund tausend Gespräche",
          "DeepSeek V4 Flash und V4 Pro Modelle",
        ],
      },
      {
        id: "max",
        name: "Max",
        price: "50 $",
        tagline: "Für Vielleser und große Bibliotheken.",
        features: [
          "Alles aus Pro",
          "30.000 KI-Credits im Monat",
          "100 GB verschlüsselte Synchronisation",
          "Neue Modelle zuerst",
        ],
      },
    ],
  },
  ru: {
    title: "Тарифы",
    lead: "Приложение бесплатно и самодостаточно — все функции чтения, ваш собственный ключ ИИ, данные на вашем диске. Платные тарифы добавляют зашифрованную синхронизацию и встроенный ИИ, а принцип один: подписка никогда не должна стоять между вами и вашей библиотекой.",
    perMonth: "/мес.",
    recommended: "Рекомендуем",
    ctaFree: "Скачать бесплатно",
    ctaPaid: "Подписаться",
    ctaPaidBusy: "Открываем оплату…",
    purchaseSuccess: "Платёж получен — тариф активен. Войдите в приложение с тем адресом почты, который указали при оплате.",
    checkoutFailed: "Не удалось начать оплату. Попробуйте ещё раз или напишите нам.",
    paidNote: "Вопросы об оплате?",
    paidNoteLink: "Напишите нам",
    finePrintTitle: "Мелкий шрифт — простыми словами",
    finePrint: [
      "Кредиты ИИ: 1 кредит = $0.001 использования модели по прейскуранту. Обычный вопрос стоит 2–4 кредита; 5 000 кредитов — это примерно тысяча диалогов. Сбрасываются ежемесячно.",
      "ИИ со своим ключом бесплатен навсегда и доступен на любом тарифе — подписка это удобство, а не стена.",
      "Синхронизируемые данные зашифрованы сквозным шифрованием. Сервер хранит только нечитаемый шифротекст; парольная фраза никогда не покидает ваши устройства.",
      "Запросы встроенного ИИ проходят через наш ретранслятор к провайдеру модели по TLS и никогда не журналируются и не сохраняются — учитывается только число токенов. Если такой компромисс не для вас, используйте свой ключ.",
      "Понижение тарифа никогда ничего не удаляет. Аккаунты сверх квоты продолжают читать и скачивать свои данные; приостанавливаются только новые загрузки.",
    ],
    plans: [
      {
        id: "free",
        name: "Бесплатный",
        price: "$0",
        tagline: "Полноценное приложение для чтения, без аккаунта.",
        features: [
          "Все функции чтения — EPUB, PDF, MOBI и другие",
          "Диалоги и память ИИ с вашим собственным API-ключом",
          "Все данные локально, на вашем диске",
          "50 МБ зашифрованной синхронизации на пробу",
        ],
      },
      {
        id: "sync",
        name: "Sync",
        price: "$5",
        tagline: "Ваша библиотека на каждом устройстве. Ключ ИИ — ваш.",
        features: [
          "10 ГБ синхронизации со сквозным шифрованием",
          "Вся библиотека, заметки, прогресс, память",
          "Без ограничения устройств",
          "ИИ со своим ключом",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: "$20",
        tagline: "Синхронизация плюс встроенный ИИ — ничего настраивать не нужно.",
        highlight: true,
        features: [
          "Всё из тарифа Sync",
          "Встроенный ИИ, без настройки ключей",
          "5 000 кредитов ИИ в месяц — около тысячи диалогов",
          "Модели DeepSeek V4 Flash и V4 Pro",
        ],
      },
      {
        id: "max",
        name: "Max",
        price: "$50",
        tagline: "Для тех, кто читает много и библиотек побольше.",
        features: [
          "Всё из тарифа Pro",
          "30 000 кредитов ИИ в месяц",
          "100 ГБ зашифрованной синхронизации",
          "Новые модели — в первую очередь",
        ],
      },
    ],
  },
  es: {
    title: "Precios",
    lead: "La aplicación es gratuita y completa por sí sola: todas las funciones de lectura, tu propia clave de IA, tus datos en tu disco. Los planes de pago añaden sincronización cifrada e IA integrada, con un principio: la suscripción nunca debe interponerse entre tú y tu biblioteca.",
    perMonth: "/mes",
    recommended: "Recomendado",
    ctaFree: "Descargar gratis",
    ctaPaid: "Suscribirse",
    ctaPaidBusy: "Abriendo el pago…",
    purchaseSuccess: "Pago recibido: tu plan está activo. Inicia sesión en la aplicación con el correo que usaste al pagar.",
    checkoutFailed: "No se pudo iniciar el pago. Inténtalo de nuevo o escríbenos.",
    paidNote: "¿Preguntas sobre la facturación?",
    paidNoteLink: "Escríbenos",
    finePrintTitle: "La letra pequeña, en claro",
    finePrint: [
      "Créditos de IA: 1 crédito = $0.001 de uso del modelo a precio de lista. Una pregunta típica cuesta 2–4 créditos; 5.000 créditos son alrededor de mil conversaciones. Se restablecen cada mes.",
      "La IA con tu propia clave es gratis para siempre, en todos los planes: la suscripción es una comodidad, no un muro.",
      "Los datos sincronizados van cifrados de extremo a extremo. El servidor solo guarda texto cifrado que no puede leer; la frase de contraseña nunca sale de tus dispositivos.",
      "Las peticiones de la IA integrada pasan por nuestro relé hacia el proveedor del modelo por TLS y nunca se registran ni se almacenan: solo se miden los recuentos de tokens. Si ese equilibrio no te convence, usa tu propia clave.",
      "Bajar de plan nunca borra nada. Las cuentas por encima de la cuota siguen leyendo y descargando sus datos; solo se pausan las subidas nuevas.",
    ],
    plans: [
      {
        id: "free",
        name: "Gratis",
        price: "$0",
        tagline: "La aplicación de lectura completa, sin cuenta.",
        features: [
          "Todas las funciones de lectura — EPUB, PDF, MOBI y más",
          "Chat y memoria de IA con tu propia clave API",
          "Todos los datos en local, en tu disco",
          "50 MB de sincronización cifrada para probar el multidispositivo",
        ],
      },
      {
        id: "sync",
        name: "Sync",
        price: "$5",
        tagline: "Tu biblioteca en todos tus dispositivos. La clave de IA la pones tú.",
        features: [
          "10 GB de sincronización cifrada de extremo a extremo",
          "Biblioteca completa, anotaciones, progreso, memoria",
          "Dispositivos ilimitados",
          "IA con tu propia clave",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: "$20",
        tagline: "Sincronización más IA integrada, sin configurar nada.",
        highlight: true,
        features: [
          "Todo lo de Sync",
          "IA integrada, sin configurar claves",
          "5.000 créditos de IA al mes — unas mil conversaciones",
          "Modelos DeepSeek V4 Flash y V4 Pro",
        ],
      },
      {
        id: "max",
        name: "Max",
        price: "$50",
        tagline: "Para grandes lectores y grandes bibliotecas.",
        features: [
          "Todo lo de Pro",
          "30.000 créditos de IA al mes",
          "100 GB de sincronización cifrada",
          "Acceso prioritario a los nuevos modelos",
        ],
      },
    ],
  },
};
