import { describe, expect, test } from "bun:test";
import type { OAuthProvider } from "../src/ports";
import { get, makeRelay, post } from "./harness";

/** A provider that hands out a fixed verified email for code "good-code". */
function fakeProvider(email = "reader@example.com"): OAuthProvider {
  return {
    authorizeUrl: (state, redirectUri) =>
      `https://provider.test/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    async exchangeCode(code) {
      if (code !== "good-code") throw new Error("bad code");
      return email;
    },
  };
}

/** Run /start and pull the state parameter back out of the redirect. */
async function startOauth(
  handle: (req: Request) => Promise<Response>,
  provider = "google",
  client?: "web",
  lang?: string,
) {
  const params = new URLSearchParams();
  if (client) params.set("client", client);
  if (lang) params.set("lang", lang);
  const query = params.size ? `?${params}` : "";
  const res = await handle(get(`/v1/auth/oauth/${provider}/start${query}`));
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location") ?? "");
  const state = location.searchParams.get("state");
  if (!state) throw new Error("no state in authorize redirect");
  return state;
}

describe("oauth sign-in", () => {
  test("start redirects to the provider with a state and the callback URI", async () => {
    const { handle } = makeRelay({}, { google: fakeProvider() });
    const res = await handle(get("/v1/auth/oauth/google/start"));
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toStartWith("https://provider.test/authorize");
    expect(location).toContain(encodeURIComponent("/v1/auth/oauth/google/callback"));
  });

  test("the app finish shows a token that verifies into the same account pipeline", async () => {
    const { handle } = makeRelay({}, { google: fakeProvider("R e a d e r@Example.com".replace(/ /g, "")) });
    const state = await startOauth(handle);
    const callback = await handle(
      get(`/v1/auth/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`),
    );
    expect(callback.status).toBe(200);
    expect(callback.headers.get("content-type")).toContain("text/html");
    const html = await callback.text();
    const token = html.match(/<code>([^<]+)<\/code>/)?.[1];
    expect(token).toBeTruthy();

    // The minted token is a plain sign-in token: /v1/auth/verify accepts it.
    const verified = await handle(post("/v1/auth/verify", { token }));
    expect(verified.status).toBe(200);
    const { session } = (await verified.json()) as { session: string };
    const account = await handle(get("/v1/account", session));
    expect(((await account.json()) as { email: string }).email).toBe("reader@example.com");
  });

  test("the web finish redirects into the web app with the token in the fragment", async () => {
    const { handle } = makeRelay(
      { webAppOrigin: "https://readaware.app" },
      { github: fakeProvider() },
    );
    const state = await startOauth(handle, "github", "web");
    const callback = await handle(
      get(`/v1/auth/oauth/github/callback?code=good-code&state=${encodeURIComponent(state)}`),
    );
    expect(callback.status).toBe(302);
    const location = callback.headers.get("location") ?? "";
    expect(location).toStartWith("https://readaware.app/sync/login?lang=en#token=");
    const token = decodeURIComponent(location.split("#token=")[1]);
    expect((await handle(post("/v1/auth/verify", { token }))).status).toBe(200);
  });

  test("the start's lang survives the state round-trip into the finish page", async () => {
    const { handle } = makeRelay({}, { google: fakeProvider() });
    const state = await startOauth(handle, "google", undefined, "ja");
    const callback = await handle(
      get(`/v1/auth/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`),
    );
    expect(callback.status).toBe(200);
    const html = await callback.text();
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain("ReadAware を開く");
  });

  test("an unknown lang falls back to English", async () => {
    const { handle } = makeRelay({}, { google: fakeProvider() });
    const state = await startOauth(handle, "google", undefined, "xx-YY");
    const callback = await handle(
      get(`/v1/auth/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`),
    );
    const html = await callback.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Open ReadAware");
  });

  test("magic link and oauth land on the SAME account for the same email", async () => {
    const { handle } = makeRelay({}, { google: fakeProvider("reader@example.com") });
    const viaEmail = await (async () => {
      const requested = await handle(post("/v1/auth/request", { email: "reader@example.com" }));
      const { devToken } = (await requested.json()) as { devToken: string };
      const verified = await handle(post("/v1/auth/verify", { token: devToken }));
      return ((await verified.json()) as { accountId: string }).accountId;
    })();
    const state = await startOauth(handle);
    const callback = await handle(
      get(`/v1/auth/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`),
    );
    const token = (await callback.text()).match(/<code>([^<]+)<\/code>/)?.[1];
    const verified = await handle(post("/v1/auth/verify", { token }));
    const { accountId } = (await verified.json()) as { accountId: string };
    expect(accountId).toBe(viaEmail);
  });

  test("state is single-use and expiring; unknown providers 404; bad exchanges 502", async () => {
    const { handle, advance } = makeRelay({}, { google: fakeProvider() });
    // Replay: consume once, second use refused.
    const state = await startOauth(handle);
    await handle(get(`/v1/auth/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`));
    const replay = await handle(
      get(`/v1/auth/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`),
    );
    expect(replay.status).toBe(401);
    // Expiry.
    const stale = await startOauth(handle);
    advance(16 * 60 * 1000);
    expect(
      (await handle(get(`/v1/auth/oauth/google/callback?code=good-code&state=${encodeURIComponent(stale)}`))).status,
    ).toBe(401);
    // A state minted for one provider cannot finish another.
    const crossed = await startOauth(handle);
    expect(
      (await handle(get(`/v1/auth/oauth/missing/callback?code=good-code&state=${encodeURIComponent(crossed)}`))).status,
    ).toBe(404);
    // Provider refuses the code.
    const bad = await startOauth(handle);
    expect(
      (await handle(get(`/v1/auth/oauth/google/callback?code=stolen&state=${encodeURIComponent(bad)}`))).status,
    ).toBe(502);
  });
});
