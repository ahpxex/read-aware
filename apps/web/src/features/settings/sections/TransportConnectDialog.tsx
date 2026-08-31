/**
 * Connect dialog for a plugin-provided sync backend (`sync:transport`).
 *
 * Much shorter than the relay's flow — there is no account and no sign-in
 * token, only "can we reach the server the plugin is configured for" and the
 * E2E passphrase ritual. The probe runs first and also answers whether the
 * remote already holds key material, so the passphrase step can say honestly
 * whether this device SETS the passphrase or must MATCH an existing one.
 * Server address and credentials live in the plugin's own settings; this
 * dialog deliberately never asks for them.
 */
import { useEffect, useRef, useState } from "react";
import { Button, Caption, Dialog, Spinner, TextField, useToast } from "@read-aware/ui";
import { describeError, useTranslation } from "../../../i18n";
import { createLogger } from "../../../platform/logger";
import type { RegisteredSyncTransport } from "../../../platform/sync/transport-registry";
import { contributionText } from "../../plugins/lib/plugin-i18n";
import {
  MIN_PASSPHRASE_LENGTH,
  SyncConnectionBusyError,
  WrongPassphraseError,
  type useSyncConnection,
} from "../hooks/useSyncConnection";

const log = createLogger("sync");

type TransportConnectDialogProps = {
  /** The transport being connected; null keeps the dialog closed. */
  transport: RegisteredSyncTransport | null;
  onClose: () => void;
  sync: ReturnType<typeof useSyncConnection>;
};

export function TransportConnectDialog({
  transport,
  onClose,
  sync,
}: TransportConnectDialogProps) {
  const { t } = useTranslation("settings");
  const { toast } = useToast();

  type Step =
    | { name: "probing" }
    | { name: "unreachable"; message: string }
    | { name: "passphrase"; hasKeys: boolean };
  const [step, setStep] = useState<Step>({ name: "probing" });
  const [passphrase, setPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const probeAttempt = useRef(0);

  const { probeTransport } = sync;
  const ref = transport?.ref ?? null;

  const probe = async (targetRef: string) => {
    const attempt = ++probeAttempt.current;
    setStep({ name: "probing" });
    try {
      const { hasKeys } = await probeTransport(targetRef);
      if (attempt !== probeAttempt.current) return;
      setStep({ name: "passphrase", hasKeys });
    } catch (error) {
      if (attempt !== probeAttempt.current) return;
      if (error instanceof SyncConnectionBusyError) {
        setStep({ name: "unreachable", message: t("dataSync.transport.checkFailed") });
        return;
      }
      log.error("sync transport probe failed", error);
      setStep({
        name: "unreachable",
        message: describeError(error, { fallback: t("dataSync.transport.checkFailed") }).body,
      });
    }
  };

  // Fresh ritual per opening: no passphrase and no probe verdict survives
  // from a previous attempt or a different transport.
  useEffect(() => {
    setPassphrase("");
    setPassphraseError(null);
    if (ref) void probe(ref);
    else probeAttempt.current += 1;
    // `probe` is recreated per render; the ritual is keyed by the transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  const handleClose = () => {
    // Password fields never linger in mounted dialog state.
    setPassphrase("");
    setPassphraseError(null);
    onClose();
  };

  const handleConnect = async () => {
    if (!transport) return;
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setPassphraseError(t("dataSync.connect.passphraseTooShort"));
      return;
    }
    setPassphraseError(null);
    try {
      await sync.connectTransport(transport.ref, passphrase);
      setPassphrase("");
      onClose();
      toast({
        variant: "success",
        title: t("dataSync.noticeDone"),
        description: t("dataSync.connect.connected"),
      });
    } catch (error) {
      if (error instanceof SyncConnectionBusyError) return;
      if (error instanceof WrongPassphraseError) {
        setPassphraseError(t("dataSync.transport.wrongPassphrase"));
        return;
      }
      log.error("transport connect failed", error);
      toast({
        variant: "destructive",
        title: t("dataSync.noticeError"),
        description: describeError(error, {
          fallback: t("dataSync.transport.checkFailed"),
        }).body,
      });
    }
  };

  const label = transport ? contributionText(transport.label) : "";

  return (
    <Dialog
      open={transport !== null}
      onClose={handleClose}
      title={t("dataSync.transport.connectTitle", { label })}
      className="max-h-full overflow-y-auto"
    >
      {step.name === "probing" ? (
        <div className="mt-6 flex min-h-24 items-center justify-center gap-2 text-fg-muted">
          <Spinner size="sm" />
          <Caption>{t("dataSync.transport.checking")}</Caption>
        </div>
      ) : step.name === "unreachable" ? (
        <div className="mt-4 space-y-4">
          <p className="text-caption leading-relaxed text-red-700">{step.message}</p>
          <Caption className="text-fg-muted">{t("dataSync.transport.settingsHint")}</Caption>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={sync.busy}
              onClick={() => {
                if (ref) void probe(ref);
              }}
            >
              {t("dataSync.transport.retry")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-caption leading-relaxed text-fg-muted">
            {step.hasKeys
              ? t("dataSync.transport.existingRemote")
              : t("dataSync.transport.freshRemote")}
          </p>
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
            <Button variant="ghost" size="sm" onClick={handleClose}>
              {t("dataSync.connect.back")}
            </Button>
            <Button size="sm" disabled={sync.busy} onClick={() => void handleConnect()}>
              {sync.busy ? t("dataSync.connect.connecting") : t("dataSync.connect.connect")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
