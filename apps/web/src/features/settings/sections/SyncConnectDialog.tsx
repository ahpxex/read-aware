/**
 * The connect-account dialog: choose a sign-in door (OAuth or magic link),
 * then paste the one-time token and set the E2E passphrase. Pulling the whole
 * flow out of the settings page keeps Data & Sync a list of quiet rows, and a
 * stacked single-column dialog can't overflow on narrow screens the way the
 * old inline form did. Form state lives here and survives the user leaving to
 * fetch their token; it resets only on a successful connect.
 */
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { GithubLogo, GoogleLogo } from "@phosphor-icons/react";
import { Button, Caption, Dialog, TextField, useToast } from "@read-aware/ui";
import { i18n, useTranslation } from "../../../i18n";
import { openExternalUrl } from "../../../platform/external-link";
import { createLogger } from "../../../platform/logger";
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

  const [step, setStep] = useState<"signIn" | "verify">("signIn");
  /**
   * Which door the user walked through — decides the verify-step hint, and
   * "link" (a deep-linked token, no pasting involved) hides the token field.
   */
  const [signInVia, setSignInVia] = useState<"email" | "oauth" | "link">("email");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);

  // A sign-in link the OS handed us: the token is already here, so the only
  // thing left to ask for is the passphrase. Consumed once, on open.
  const [linkToken, setLinkToken] = useAtom(syncLoginTokenAtom);
  useEffect(() => {
    if (!open || !linkToken) return;
    setToken(linkToken);
    setSignInVia("link");
    setStep("verify");
    setPassphraseError(null);
    setLinkToken(null);
  }, [open, linkToken, setLinkToken]);

  const reset = () => {
    setStep("signIn");
    setSignInVia("email");
    setEmail("");
    setToken("");
    setPassphrase("");
    setPassphraseError(null);
  };

  const handleOauth = (provider: "google" | "github") => {
    // The dance finishes in the system browser: the relay's finish page fires
    // the readaware:// deep link back into the app (with a copyable token as
    // fallback — the same token field the magic link uses). `lang` makes that
    // page render in the app's locale; it travels with the OAuth state.
    void openExternalUrl(
      `${relayBaseUrl()}/v1/auth/oauth/${provider}/start?lang=${encodeURIComponent(i18n.language)}`,
    );
    setSignInVia("oauth");
    setStep("verify");
  };

  const handleSend = async () => {
    try {
      const devToken = await sync.sendLink(email);
      setSignInVia("email");
      if (devToken) setToken(devToken);
      setStep("verify");
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
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setPassphraseError(t("dataSync.connect.passphraseTooShort"));
      return;
    }
    setPassphraseError(null);
    try {
      await sync.connect(token, passphrase);
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
      onClose={onClose}
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
      ) : (
        <div className="mt-4 space-y-4">
          <Caption className="text-fg-muted">
            {signInVia === "link"
              ? t("dataSync.connect.linkReady")
              : signInVia === "oauth"
                ? t("dataSync.connect.oauthStarted")
                : t("dataSync.connect.sent")}
          </Caption>
          {signInVia !== "link" && (
            <TextField
              label={t("dataSync.connect.tokenLabel")}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
            />
          )}
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
            <Button variant="ghost" size="sm" onClick={() => setStep("signIn")}>
              {t("dataSync.connect.back")}
            </Button>
            <Button
              size="sm"
              disabled={sync.busy || token.trim().length === 0}
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
