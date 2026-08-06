/**
 * Runtime copy, resolved against the live app locale (`ctx.locale`) the same
 * way the host resolves PluginText: exact tag, then base language, then the
 * English default.
 */

type Localized = { default: string; [locale: string]: string };

const STRINGS = {
  /** The empty-value entry offered at the top of a listed voice catalog. */
  defaultVoice: {
    default: "Default voice",
    "zh-Hans": "默认声音",
    "zh-Hant": "預設聲音",
    ja: "既定のボイス",
    ru: "Голос по умолчанию",
    fr: "Voix par défaut",
    de: "Standardstimme",
    es: "Voz predeterminada",
  },
  /** Read-aloud label descriptor when no voice/model is picked. */
  descriptorDefault: {
    default: "default",
    "zh-Hans": "默认",
    "zh-Hant": "預設",
    ja: "既定",
    ru: "по умолчанию",
    fr: "défaut",
    de: "Standard",
    es: "predeterminada",
  },
  /** Read-aloud label descriptor for an unconfigured local endpoint. */
  descriptorLocal: {
    default: "local",
    "zh-Hans": "本地",
    "zh-Hant": "本地",
    ja: "ローカル",
    ru: "локальный",
    fr: "local",
    de: "lokal",
    es: "local",
  },
  /** `{vendor}` — the provider's display name. */
  keyMissing: {
    default: "{vendor} API key not set — add it in Settings → TTS Voices",
    "zh-Hans": "未设置 {vendor} API 密钥——请到 设置 → TTS Voices 填写",
    "zh-Hant": "未設定 {vendor} API 金鑰——請到 設定 → TTS Voices 填寫",
    ja: "{vendor} のAPIキーが未設定です。設定 → TTS Voices で追加してください",
    ru: "Ключ API {vendor} не задан — добавьте его в Настройки → TTS Voices",
    fr: "Clé API {vendor} manquante — ajoutez-la dans Réglages → TTS Voices",
    de: "{vendor}-API-Schlüssel fehlt — in Einstellungen → TTS Voices hinterlegen",
    es: "Falta la clave de API de {vendor}: añádela en Ajustes → TTS Voices",
  },
  /** `{vendor}` and `{status}` — a failed synthesis HTTP status. */
  vendorStatus: {
    default: "{vendor} returned {status}",
    "zh-Hans": "{vendor} 返回了 {status}",
    "zh-Hant": "{vendor} 回傳了 {status}",
    ja: "{vendor} が {status} を返しました",
    ru: "{vendor} вернул {status}",
    fr: "{vendor} a renvoyé {status}",
    de: "{vendor} hat {status} zurückgegeben",
    es: "{vendor} devolvió {status}",
  },
  /** The custom provider needs its endpoint before it can speak. */
  endpointMissing: {
    default: "Set the custom endpoint URL in Settings → TTS Voices",
    "zh-Hans": "请到 设置 → TTS Voices 填写自定义端点地址",
    "zh-Hant": "請到 設定 → TTS Voices 填寫自訂端點位址",
    ja: "設定 → TTS Voices でカスタムエンドポイントのURLを設定してください",
    ru: "Укажите URL своего сервера в Настройки → TTS Voices",
    fr: "Définissez l'URL du point de terminaison dans Réglages → TTS Voices",
    de: "Die Endpunkt-URL in Einstellungen → TTS Voices setzen",
    es: "Configura la URL del endpoint en Ajustes → TTS Voices",
  },
} satisfies Record<string, Localized>;

export type TtsStringKey = keyof typeof STRINGS;

export function tr(
  locale: string,
  key: TtsStringKey,
  params?: Record<string, string | number>,
): string {
  const bundle: Localized = STRINGS[key];
  const requested = locale.toLowerCase();
  const base = requested.split("-")[0];
  const exact = Object.keys(bundle).find(
    (candidate) => candidate !== "default" && candidate.toLowerCase() === requested,
  );
  const baseMatch =
    exact ??
    Object.keys(bundle).find(
      (candidate) => candidate !== "default" && candidate.toLowerCase() === base,
    );
  let text = bundle[baseMatch ?? "default"] ?? bundle.default;
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}
