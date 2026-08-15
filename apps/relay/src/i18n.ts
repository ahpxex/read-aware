/**
 * The relay's user-facing strings — the magic-link email and the OAuth finish
 * page — in the app's eight locales. The client sends its active locale
 * (`lang` in the auth request body / OAuth start query); everything else on
 * the relay is JSON for machines and stays English.
 *
 * Deliberately a plain object, not a framework: eight short strings per
 * locale. Keep terminology in lockstep with apps/web/src/i18n/locales
 * (zh-Hant says 權杖 for token, zh-Hans says 令牌, ja says トークン).
 */

export const RELAY_LANGS = [
  "en",
  "zh-Hans",
  "zh-Hant",
  "ja",
  "de",
  "es",
  "fr",
  "ru",
] as const;

export type RelayLang = (typeof RELAY_LANGS)[number];

/** Normalize a client-supplied lang to a supported one; unknown → en. */
export function resolveLang(input: string | null | undefined): RelayLang {
  if (!input) return "en";
  const exact = RELAY_LANGS.find((l) => l.toLowerCase() === input.toLowerCase());
  if (exact) return exact;
  const base = input.split("-")[0].toLowerCase();
  if (base === "zh") return "zh-Hans";
  const prefix = RELAY_LANGS.find((l) => l.split("-")[0] === base);
  return prefix ?? "en";
}

type EmailStrings = {
  subject: string;
  click: string;
  fallback: string;
  expires: string;
};

type PageStrings = {
  signedIn: string;
  opening: string;
  open: string;
  fallbackSummary: string;
  expires: string;
};

export const EMAIL: Record<RelayLang, EmailStrings> = {
  en: {
    subject: "Sign in to ReadAware Sync",
    click: "Click this link to finish signing in to ReadAware:",
    fallback:
      "If it does not open the app, paste the link into ReadAware's Data & Sync settings instead.",
    expires: "The link expires in 15 minutes. If you did not request it, ignore this email.",
  },
  "zh-Hans": {
    subject: "登录 ReadAware 同步",
    click: "点击此链接完成 ReadAware 登录：",
    fallback: "如果没有打开应用，把链接粘贴到 ReadAware 的「数据与同步」设置中。",
    expires: "链接 15 分钟内有效。如果这不是你的操作，请忽略这封邮件。",
  },
  "zh-Hant": {
    subject: "登入 ReadAware 同步",
    click: "點擊此連結完成 ReadAware 登入：",
    fallback: "如果沒有開啟應用程式，請把連結貼到 ReadAware 的「資料與同步」設定中。",
    expires: "連結 15 分鐘內有效。如果這不是你的操作，請忽略這封郵件。",
  },
  ja: {
    subject: "ReadAware Sync にサインイン",
    click: "次のリンクをクリックして ReadAware へのサインインを完了してください：",
    fallback:
      "アプリが開かない場合は、リンクを ReadAware の「データと同期」設定に貼り付けてください。",
    expires: "リンクの有効期限は 15 分です。心当たりがない場合は、このメールを無視してください。",
  },
  de: {
    subject: "Bei ReadAware Sync anmelden",
    click: "Klicke auf diesen Link, um die Anmeldung bei ReadAware abzuschließen:",
    fallback:
      "Falls sich die App nicht öffnet, füge den Link stattdessen in ReadAwares Einstellungen unter „Daten & Sync“ ein.",
    expires:
      "Der Link ist 15 Minuten gültig. Falls du ihn nicht angefordert hast, ignoriere diese E-Mail.",
  },
  es: {
    subject: "Inicia sesión en ReadAware Sync",
    click: "Haz clic en este enlace para terminar de iniciar sesión en ReadAware:",
    fallback:
      "Si la aplicación no se abre, pega el enlace en los ajustes de «Datos y sincronización» de ReadAware.",
    expires: "El enlace caduca en 15 minutos. Si no lo solicitaste, ignora este correo.",
  },
  fr: {
    subject: "Connexion à ReadAware Sync",
    click: "Cliquez sur ce lien pour terminer votre connexion à ReadAware :",
    fallback:
      "Si l'application ne s'ouvre pas, collez le lien dans les réglages « Données et synchronisation » de ReadAware.",
    expires:
      "Le lien expire dans 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
  },
  ru: {
    subject: "Вход в ReadAware Sync",
    click: "Нажмите на эту ссылку, чтобы завершить вход в ReadAware:",
    fallback:
      "Если приложение не открылось, вставьте ссылку в настройки ReadAware «Данные и синхронизация».",
    expires:
      "Ссылка действительна 15 минут. Если вы её не запрашивали, просто проигнорируйте это письмо.",
  },
};

export const PAGE: Record<RelayLang, PageStrings> = {
  en: {
    signedIn: "Signed in",
    opening: "Opening ReadAware to finish connecting…",
    open: "Open ReadAware",
    fallbackSummary: "The app didn't open? Paste this token instead.",
    expires: "The token expires in 15 minutes. You can close this tab.",
  },
  "zh-Hans": {
    signedIn: "登录成功",
    opening: "正在打开 ReadAware 完成连接…",
    open: "打开 ReadAware",
    fallbackSummary: "没有打开？改为粘贴此令牌。",
    expires: "令牌 15 分钟内有效，本页可以关闭。",
  },
  "zh-Hant": {
    signedIn: "登入成功",
    opening: "正在開啟 ReadAware 完成連接…",
    open: "開啟 ReadAware",
    fallbackSummary: "沒有開啟？改為貼上此權杖。",
    expires: "權杖 15 分鐘內有效，本頁可以關閉。",
  },
  ja: {
    signedIn: "サインイン完了",
    opening: "ReadAware を開いて接続を完了しています…",
    open: "ReadAware を開く",
    fallbackSummary: "開かない場合は、このトークンを貼り付けてください。",
    expires: "トークンの有効期限は 15 分です。このタブは閉じて構いません。",
  },
  de: {
    signedIn: "Angemeldet",
    opening: "ReadAware wird geöffnet, um die Verbindung abzuschließen …",
    open: "ReadAware öffnen",
    fallbackSummary: "App nicht geöffnet? Füge stattdessen dieses Token ein.",
    expires: "Das Token ist 15 Minuten gültig. Du kannst diesen Tab schließen.",
  },
  es: {
    signedIn: "Sesión iniciada",
    opening: "Abriendo ReadAware para terminar de conectar…",
    open: "Abrir ReadAware",
    fallbackSummary: "¿No se abrió? Pega este token en su lugar.",
    expires: "El token caduca en 15 minutos. Puedes cerrar esta pestaña.",
  },
  fr: {
    signedIn: "Connecté",
    opening: "Ouverture de ReadAware pour terminer la connexion…",
    open: "Ouvrir ReadAware",
    fallbackSummary: "L'application ne s'est pas ouverte ? Collez ce jeton à la place.",
    expires: "Le jeton expire dans 15 minutes. Vous pouvez fermer cet onglet.",
  },
  ru: {
    signedIn: "Вход выполнен",
    opening: "Открываем ReadAware, чтобы завершить подключение…",
    open: "Открыть ReadAware",
    fallbackSummary: "Приложение не открылось? Вставьте этот токен вручную.",
    expires: "Токен действителен 15 минут. Эту вкладку можно закрыть.",
  },
};
