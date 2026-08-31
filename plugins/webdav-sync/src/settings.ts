/**
 * Settings access + endpoint identity.
 *
 * The manifest declares serverUrl / username / basePath (KV) and password
 * (secret store). Manifest `value` defaults never reach storage (the settings
 * object is null until the user first saves), so defaults are merged here.
 *
 * `endpointId` is the transport contract's stable mailbox identity: the host
 * binds push/pull bookkeeping to it at connect, and refuses to sync when a
 * later `open()` reports a different one — changing the server, account, or
 * folder is "a different mailbox", never a silent re-target.
 */

export type WebdavSettings = {
  serverUrl: string;
  username: string;
  basePath: string;
};

export const DEFAULT_BASE_PATH = "ReadAware";

/** Raw settings object as the host stores it (null until first saved). */
export type StoredSettings = Record<string, unknown> | null;

export class WebdavNotConfiguredError extends Error {
  constructor(what: string) {
    super(`WebDAV sync is not configured: ${what}`);
    this.name = "WebdavNotConfiguredError";
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Path → clean segment list: "a//b/" → ["a","b"]. */
function pathSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

export function readWebdavSettings(stored: StoredSettings): WebdavSettings {
  const serverUrl = str(stored?.serverUrl);
  if (!serverUrl) throw new WebdavNotConfiguredError("server URL is empty");
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new WebdavNotConfiguredError(`"${serverUrl}" is not a valid URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new WebdavNotConfiguredError(`unsupported protocol "${parsed.protocol}"`);
  }
  return {
    serverUrl,
    username: str(stored?.username),
    basePath: str(stored?.basePath) || DEFAULT_BASE_PATH,
  };
}

/**
 * The normalized root URL everything is stored under (no trailing slash):
 * server URL + base folder.
 */
export function webdavRootUrl(settings: WebdavSettings): string {
  const url = new URL(settings.serverUrl);
  const segments = [...pathSegments(url.pathname), ...pathSegments(settings.basePath)];
  url.pathname = `/${segments.join("/")}`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/**
 * Stable, human-readable mailbox identity: `user@host/path`. Deliberately
 * excludes the password (rotating it is the same mailbox) and the URL scheme
 * (http→https migration of the same server is the same mailbox).
 */
export function webdavEndpointId(settings: WebdavSettings): string {
  const url = new URL(webdavRootUrl(settings));
  const host = url.port ? `${url.hostname.toLowerCase()}:${url.port}` : url.hostname.toLowerCase();
  return `${settings.username}@${host}${url.pathname}`;
}
