/**
 * The connect-account dialog: choose a sign-in door (OAuth or magic link),
 * paste the one-time token, CONFIRM WHICH ACCOUNT it opened, then set the E2E
 * passphrase. The confirmation step is the login-CSRF defense and may not be
 * skipped: a sign-in token can be delivered by any web page
 * (readaware://sync/login/<token>) or pasted from anywhere, and the moment a
 * passphrase lands, this device's whole library adopts that account — so the
 * email is shown before the passphrase field ever appears. Pulling the whole
 * flow out of the settings page keeps Data & Sync a list of quiet rows, and a
 * stacked single-column dialog can't overflow on narrow screens. Form state
 * lives here and survives the user leaving to fetch their token; it resets
 * only on a successful connect.
 */
import { useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { GithubLogo, GoogleLogo } from "@phosphor-icons/react";
import { Button, Caption, Dialog, Spinner, TextField, useToast } from "@read-aware/ui";
import { i18n, useTranslation } from "../../../i18n";
import { openExternalUrl } from "../../../platform/external-link";
import { createLogger } from "../../../platform/logger";
import type { SignInVerification } from "../../../platform/sync/connect";
import { relayBaseUrl } from "../../../platform/sync/sync-scheduler";
import { syncLoginTokenAtom } from "../../../state/ui";
import {
  MIN_PASSPHRASE_LENGTH,
  WrongPassphraseError,
  type useSyncConnection,
} from "../hooks/useSyncConnection";

const log = createLogger("sync");

type SyncConnectDialogProps = {
  open: boolean;
  onClose: () => void;
  sync: ReturnType<typeof useSyncConnection>;
};

export function SyncConnectDialog({ open, onClose, sync }: SyncConnectDialogProps) {
  const { t } = useTranslation("settings");
  const { toast } = useToast();

  type Step = "signIn" | "token" | "verifying" | "confirm" | "passphrase";
  const [step, setStep] = useState<Step>("signIn");
  /**
   * Which door the user walked through — decides the token-step hint; "link"
   * (a deep-linked token) skips the paste field by auto-verifying.
   */
  const [signInVia, setSignInVia] = useState<"email" | "oauth" | "link">("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [verification, setVerification] = useState<SignInVerification | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const verificationAttempt = useRef(0);

  const reset = () => {
    setStep("signIn");
    setSignInVia("email");
    setEmail("");
    setToken("");
    setTokenError(null);
    setVerification(null);
    setPassphrase("");
    setPassphraseError(null);
  };

  /** Phase 1: burn the token, learn the account, land on the confirm step. */
  const verifyToken = async (rawToken: string, via: "email" | "oauth" | "link") => {
    const attempt = ++verificationAttempt.current;
    setTokenError(null);
    setVerification(null);
    // A new token means a new identity. No secret typed for the previous
    // identity may survive across this boundary — especially when a deep link
    // arrives while the confirmation screen is already open.
    setPassphrase("");
    setPassphraseError(null);
    setSignInVia(via);
    setStep("verifying");
    try {
      const verified = await sync.verifyToken(rawToken);
      if (attempt !== verificationAttempt.current) return;
      setVerification(verified);
      setStep("confirm");
    } catch (error) {
      if (attempt !== verificationAttempt.current) return;
      log.error("sign-in token verification failed", error);
      // The token is single-use and short-lived: anything from a typo to a
      // spent link lands here. Show it on the token field (or on the link
      // notice when a deep link delivered it) and let the user request anew.
      if (via === "link") {
        setToken("");
      }
      setStep("token");
      setTokenError(t("dataSync.connect.tokenInvalid"));
    }
  };

  const handleClose = () => {
    // Password fields should never linger in mounted dialog state after the
    // user dismisses the surface. A verified identity may survive, but it must
    // be confirmed again before the password field can reappear.
    setPassphrase("");
    setPassphraseError(null);
    if (verification) setStep("confirm");
    onClose();
  };

  const restartSignIn = () => {
    setStep("signIn");
    setToken("");
    setTokenError(null);
    setVerification(null);
    setPassphrase("");
    setPassphraseError(null);
  };

  // A sign-in link the OS handed us: verify it right away — the email it
  // opens must be on screen before any passphrase is asked for. Consumed
  // once, on open.
  const [linkToken, setLinkToken] = useAtom(syncLoginTokenAtom);
  useEffect(() => {
    if (!open || !linkToken) return;
    setLinkToken(null);
    void verifyToken(linkToken, "link");
    // Fires exactly once per delivered link token (consumed above); the
    // verifyToken closure is recreated per render, which is fine here.
  }, [open, linkToken, setLinkToken]);

  const handleOauth = (provider: "google" | "github") => {
    // The dance finishes in the system browser: the relay's finish page fires
    // the readaware:// deep link back into the app (with a copyable token as
    // fallback — the same token field the magic link uses). `lang` makes that
    // page render in the app's locale; it travels with the OAuth state.
    void openExternalUrl(
      `${relayBaseUrl()}/v1/auth/oauth/${provider}/start?lang=${encodeURIComponent(i18n.language)}`,
    );
    setSignInVia("oauth");
    setStep("token");
  };

  const handleSend = async () => {
    try {
      const devToken = await sync.sendLink(email);
      setSignInVia("email");
      if (devToken) setToken(devToken);
      setStep("token");
    } catch (error) {
      log.error("magic link request failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.connect.failed"),
      });
    }
  };

  const handleConnect = async () => {
    if (!verification) return;
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setPassphraseError(t("dataSync.connect.passphraseTooShort"));
      return;
    }
    setPassphraseError(null);
    try {
      await sync.finishConnect(verification, passphrase);
      reset();
      onClose();
      toast({
        variant: "success",
        title: t("dataSync.noticeDone"),
        description: t("dataSync.connect.connected"),
      });
    } catch (error) {
      if (error instanceof WrongPassphraseError) {
        setPassphraseError(t("dataSync.connect.wrongPassphrase"));
        return;
      }
      log.error("connect failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: t("dataSync.connect.failed"),
      });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("dataSync.connectAccount")}
      className="max-h-full overflow-y-auto"
    >
      {step === "signIn" ? (
        <div className="mt-4 space-y-4">
          <Caption className="text-fg-muted">{t("dataSync.account.description")}</Caption>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={() => handleOauth("google")}>
              <GoogleLogo size={16} aria-hidden="true" />
              {t("dataSync.connect.google")}
            </Button>
            <Button variant="outline" onClick={() => handleOauth("github")}>
              <GithubLogo size={16} aria-hidden="true" />
              {t("dataSync.connect.github")}
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <Caption className="text-fg-muted">{t("dataSync.connect.orEmail")}</Caption>
            <span className="h-px flex-1 bg-border" />
          </div>
          <TextField
            label={t("dataSync.connect.emailLabel")}
            type="email"
            placeholder={t("dataSync.connect.emailPlaceholder")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <Button
            className="w-full"
            disabled={sync.busy || !email.includes("@")}
            onClick={() => void handleSend()}
          >
            {sync.busy ? t("dataSync.connect.sending") : t("dataSync.connect.send")}
          </Button>
        </div>
      ) : step === "token" ? (
        <div className="mt-4 space-y-4">
          <Caption className="text-fg-muted">
            {signInVia === "oauth"
              ? t("dataSync.connect.oauthStarted")
              : t("dataSync.connect.sent")}
          </Caption>
          <TextField
            label={t("dataSync.connect.tokenLabel")}
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              setTokenError(null);
            }}
            error={tokenError ?? undefined}
            autoComplete="off"
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep("signIn")}>
              {t("dataSync.connect.back")}
            </Button>
            <Button
              size="sm"
              disabled={sync.busy || token.trim().length === 0}
              onClick={() => void verifyToken(token, signInVia)}
            >
              {sync.busy ? t("dataSync.connect.verifying") : t("dataSync.connect.tokenContinue")}
            </Button>
          </div>
        </div>
      ) : step === "verifying" ? (
        <div className="mt-6 flex min-h-24 items-center justify-center gap-2 text-fg-muted">
          <Spinner size="sm" />
          <Caption>{t("dataSync.connect.verifying")}</Caption>
        </div>
      ) : step === "confirm" ? (
        <div className="mt-4 space-y-4">
          {/* The identity gate is its own user action. No passphrase input is
              mounted until the user explicitly continues from this account. */}
          <div className="rounded-md border border-border bg-paper-warm px-3 py-2.5">
            <Caption className="text-fg-muted">{t("dataSync.connect.signedInAs")}</Caption>
            <p className="mt-0.5 font-medium break-all">{verification?.email}</p>
          </div>
          {verification?.keys == null && (
            <p className="text-caption leading-relaxed text-fg-muted">
              {t("dataSync.connect.freshAccount")}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={restartSignIn}>
              {t("dataSync.connect.back")}
            </Button>
            <Button size="sm" disabled={!verification} onClick={() => setStep("passphrase")}>
              {t("dataSync.connect.tokenContinue")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-border bg-paper-warm px-3 py-2.5">
            <Caption className="text-fg-muted">{t("dataSync.connect.signedInAs")}</Caption>
            <p className="mt-0.5 font-medium break-all">{verification?.email}</p>
          </div>
          <TextField
            label={t("dataSync.connect.passphraseLabel")}
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            helperText={t("dataSync.connect.passphraseHint")}
            error={passphraseError ?? undefined}
            autoComplete="new-password"
          />
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPassphrase("");
                setPassphraseError(null);
                setStep("confirm");
              }}
            >
              {t("dataSync.connect.back")}
            </Button>
            <Button
              size="sm"
              disabled={sync.busy || !verification}
              onClick={() => void handleConnect()}
            >
              {sync.busy ? t("dataSync.connect.connecting") : t("dataSync.connect.connect")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
