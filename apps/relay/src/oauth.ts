/**
 * Google / GitHub OAuth providers — each reduced to the one fact the relay
 * wants: a verified email address. Standard confidential-client authorization
 * code flow (the client secret lives in Worker secrets, so no PKCE needed).
 *
 * OAuth here only replaces "prove you own this email". Everything after —
 * the single-use sign-in token, the session, the E2E passphrase — is the
 * SAME pipeline as the magic link, so adding a provider never touches the
 * account or key machinery.
 */
import type { OAuthProvider } from "./ports";

async function postForm(url: string, form: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
}

export function googleProvider(clientId: string, clientSecret: string): OAuthProvider {
  return {
    authorizeUrl(state, redirectUri) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email",
        state,
        prompt: "select_account",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    },
    async exchangeCode(code, redirectUri) {
      const tokenRes = await postForm("https://oauth2.googleapis.com/token", {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      if (!tokenRes.ok) {
        throw new Error(`google token exchange failed: ${tokenRes.status}`);
      }
      const { access_token } = (await tokenRes.json()) as { access_token?: string };
      if (!access_token) throw new Error("google token exchange returned no access token");
      const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${access_token}` },
      });
      if (!infoRes.ok) throw new Error(`google userinfo failed: ${infoRes.status}`);
      const info = (await infoRes.json()) as { email?: string; email_verified?: boolean };
      if (!info.email || info.email_verified !== true) {
        throw new Error("google account has no verified email");
      }
      return info.email;
    },
  };
}

export function githubProvider(clientId: string, clientSecret: string): OAuthProvider {
  return {
    authorizeUrl(state, redirectUri) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "user:email",
        state,
      });
      return `https://github.com/login/oauth/authorize?${params}`;
    },
    async exchangeCode(code, redirectUri) {
      const tokenRes = await postForm("https://github.com/login/oauth/access_token", {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      });
      if (!tokenRes.ok) {
        throw new Error(`github token exchange failed: ${tokenRes.status}`);
      }
      const { access_token } = (await tokenRes.json()) as { access_token?: string };
      if (!access_token) throw new Error("github token exchange returned no access token");
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: {
          authorization: `Bearer ${access_token}`,
          accept: "application/vnd.github+json",
          // GitHub's API rejects requests without a UA.
          "user-agent": "read-aware-relay",
        },
      });
      if (!emailsRes.ok) throw new Error(`github emails lookup failed: ${emailsRes.status}`);
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const chosen = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (!chosen) throw new Error("github account has no verified email");
      return chosen.email;
    },
  };
}
