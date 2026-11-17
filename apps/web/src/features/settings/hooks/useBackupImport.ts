import { causalActor } from "../../../platform/domain-actor";
import { useLayoutEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { AppError, errorCode } from "@read-aware/core";
import { getVersion } from "@tauri-apps/api/app";
import type { PluginBookAccess } from "@read-aware/plugin-types";
import { describeError } from "../../../i18n/describe-error";
import { createLogger } from "../../../platform/logger";
import { libraryBooksAtom } from "../../library/state/library-store";
import { requestInstallConsent } from "../../plugins/state/plugin-store";
import { validBackupPassword } from "../lib/backup-password";
import { prepareFullBackupImport } from "../lib/full-backup-import";
import type { FullBackupReview, FullBackupImportProgress } from "../lib/full-backup-import-task";
import type { FullBackupRestoreReceipt } from "../lib/full-backup-apply";
import { reviewFullBackupPrograms } from "../lib/full-backup-program-review";
import { migrateFullBackupPrograms } from "../lib/full-backup-program-migration";
import { loadBackupReviewModel, type BackupReviewModel } from "../lib/full-backup-review-model";

export type BackupImportOutcome = FullBackupRestoreReceipt | null;
/** The merge the reader confirms once: what the backup adds, nothing to pick. */
type ReviewView = {
  step: "review";
  review: FullBackupReview;
  model: BackupReviewModel;
  busy: boolean;
  error?: string;
};
type View =
  | { step: "form"; password: string; error?: string }
  | { step: "running"; progress: FullBackupImportProgress | "migrating" | null; cancelling: boolean }
  | ReviewView
  | { step: "consent" }
  | { step: "result"; receipt: FullBackupRestoreReceipt }
  | { step: "failure"; error: string; restart: boolean };
type Flight = {
  controller: AbortController;
  signal: AbortSignal;
  review?: FullBackupReview;
  resolve(result: BackupImportOutcome): void;
  reject(error: unknown): void;
  cleanup(): void;
  running: boolean;
};
const log = createLogger("backup-import");

export function useBackupImport() {
  const [view, setView] = useState<View | null>(null);
  const libraryBooks = useAtomValue(libraryBooksAtom);
  const flight = useRef<Flight | null>(null),
    mounted = useRef(false),
    currentView = useRef(view);
  const publish = (value: View | null) => {
    currentView.current = value;
    if (mounted.current) setView(value);
  };
  const finish = (current: Flight, result: BackupImportOutcome, error?: unknown) => {
    if (flight.current !== current) return;
    flight.current = null;
    current.cleanup();
    if (error !== undefined) current.reject(error);
    else current.resolve(result);
  };
  const cancelFlight = async (current: Flight) => {
    await current.review?.dispose();
    if (flight.current === current) {
      publish(null);
      finish(current, null);
    }
  };
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flight.current?.controller.abort();
    };
  }, []);
  const request = (external?: AbortSignal): Promise<BackupImportOutcome> => {
    external?.throwIfAborted();
    if (!mounted.current || flight.current)
      return Promise.reject(new AppError("ui/unavailable", "Backup import surface is unavailable"));
    return new Promise((resolve, reject) => {
      const controller = new AbortController(),
        signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal;
      const current: Flight = {
        controller,
        signal,
        resolve,
        reject,
        running: false,
        cleanup: () => signal.removeEventListener("abort", abort),
      };
      const abort = () => {
        if (!current.running) void cancelFlight(current);
        else if (currentView.current?.step === "running") publish({ ...currentView.current, cancelling: true });
      };
      flight.current = current;
      signal.addEventListener("abort", abort, { once: true });
      publish({ step: "form", password: "" });
    });
  };
  const progress = (value: FullBackupImportProgress | "migrating") => {
    if (currentView.current?.step === "running") publish({ ...currentView.current, progress: value });
  };
  const edit = (patch: { password?: string }) => {
    const value = currentView.current;
    if (value?.step === "form") publish({ ...value, ...patch, error: undefined });
  };
  const submit = async () => {
    const current = flight.current,
      value = currentView.current;
    if (!current || current.running || value?.step !== "form") return;
    if (!validBackupPassword(value.password)) {
      publish({ ...value, error: "password" });
      return;
    }
    current.running = true;
    publish({ step: "running", progress: null, cancelling: false });
    try {
      // A retired v1 JSON file is identified natively and rejected with
      // `backup/legacy-format`, which the form reports like any other source error.
      const review = await prepareFullBackupImport(value.password, current.signal, progress);
      if (!review) {
        publish(null);
        finish(current, null);
        return;
      }
      current.review = review;
      const model = await loadBackupReviewModel(review);
      current.signal.throwIfAborted();
      publish({ step: "review", review, model, busy: false });
    } catch (error) {
      log.warn("Backup preparation failed", error);
      await current.review?.dispose();
      current.review = undefined;
      if (current.signal.aborted) {
        publish(null);
        finish(current, null);
      } else publish({ step: "form", password: "", error: describeError(error).body });
    } finally {
      current.running = false;
    }
  };
  const restore = async () => {
    const current = flight.current,
      value = currentView.current;
    if (!current || current.running || value?.step !== "review" || value.review.plan.conflictingEvents) return;
    const origin = causalActor("user");
    current.running = true;
    publish({ ...value, busy: true });
    try {
      const choices = new Map(Object.entries(value.model.programChoices));
      const version = await getVersion();
      const programs = await reviewFullBackupPrograms(value.review, choices, version, current.signal);
      const grants = new Map<string, PluginBookAccess>();
      const books = libraryBooks.map(({ id, title }) => ({ id, title }));
      for (const program of programs) {
        if (!program.consentRequired || !program.manifest) continue;
        publish({ step: "consent" });
        const consent = await requestInstallConsent(program.manifest, current.signal, books);
        current.signal.throwIfAborted();
        // Declined code is not installed; the plugin's data is still restored
        // and waits, inactive, for code the reader approves.
        if (!consent.approved) {
          const choice = choices.get(program.id);
          if (choice) choices.set(program.id, { ...choice, program: null });
          continue;
        }
        grants.set(program.id, structuredClone(consent.grant));
      }
      publish({ step: "running", progress: "migrating", cancelling: false });
      const programResults = await migrateFullBackupPrograms(
        value.review,
        choices,
        grants,
        version,
        current.signal,
        origin,
      );
      current.signal.throwIfAborted();
      progress("restoring");
      const receipt = await value.review.apply(
        {
          files: value.model.fileChoices,
          programs: Object.fromEntries(choices),
          credentials: value.model.credentialChoices,
          programResults,
        },
        origin,
      );
      await value.review.dispose();
      publish({ step: "result", receipt });
      finish(current, receipt);
    } catch (error) {
      log.error("Full backup restore failed", error);
      if (errorCode(error) === "backup/recovery-required") {
        await value.review.dispose();
        publish({ step: "failure", error: describeError(error).body, restart: true });
        finish(current, null, error);
      } else if (current.signal.aborted) await cancelFlight(current);
      else if (value.review.disposed) {
        await value.review.dispose();
        publish({ step: "failure", error: describeError(error).body, restart: false });
        finish(current, null, error);
      } else publish({ ...value, busy: false, error: describeError(error).body });
    } finally {
      current.running = false;
    }
  };
  const cancel = () => {
    if (view?.step === "result" || (view?.step === "failure" && view.restart)) {
      window.location.reload();
      return;
    }
    if (flight.current) flight.current.controller.abort();
    else publish(null);
  };
  return {
    view,
    request,
    edit,
    submit,
    cancel,
    restore,
    reload: () => window.location.reload(),
  };
}
