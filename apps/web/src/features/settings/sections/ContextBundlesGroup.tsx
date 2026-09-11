import { Button, InlineError, Select, Spinner } from "@read-aware/ui";
import type { ContextBundleKind } from "@read-aware/core";
import { formatDate, useTranslation } from "../../../i18n";
import { describeError } from "../../../i18n/describe-error";
import { SettingsGroup } from "../components/SettingsGroup";
import { SettingsRow } from "../components/SettingsRow";
import { useContextBundles } from "../hooks/useContextBundles";
import { CONTEXT_BUNDLE_RECIPES, shortContextBundleVersion, type ContextBundleScopeChoice } from "../lib/context-bundle-settings";

export function ContextBundlesGroup() {
  const { t } = useTranslation(["settings", "common"]);
  const bundles = useContextBundles();
  const label = (choice: ContextBundleScopeChoice) => choice.kind === "user" ? t("settings:dataSync.contextBundles.scopeReader")
    : choice.kind === "book" ? t("settings:dataSync.contextBundles.scopeBook", { title: choice.title })
    : t("settings:dataSync.contextBundles.scopeThread", { title: choice.title || t("settings:dataSync.contextBundles.untitledThread") });
  const failure = bundles.history.status === "failed"
    ? describeError(bundles.history.error, { fallback: t("settings:dataSync.contextBundles.loadFailed") }) : null;

  return <SettingsGroup title={t("settings:dataSync.contextBundles.title")}
    description={bundles.supported ? t("settings:dataSync.contextBundles.description") : t("settings:dataSync.contextBundles.descWeb")}>
    <SettingsRow borderless title={t("settings:dataSync.contextBundles.recipe")}
      control={<Select ariaLabel={t("settings:dataSync.contextBundles.recipe")} variant="outlined" disabled={!bundles.supported || bundles.busy !== null}
        value={bundles.recipe} onChange={value => bundles.setRecipe(value as ContextBundleKind)}
        options={CONTEXT_BUNDLE_RECIPES.map(kind => ({ value: kind, label: t(`settings:dataSync.contextBundles.recipes.${kind}`) }))} />} />
    <SettingsRow title={t("settings:dataSync.contextBundles.scope")}
      description={bundles.supported && bundles.choices.length === 0 ? t("settings:dataSync.contextBundles.noScope") : undefined}
      control={bundles.choices.length > 0 && <Select ariaLabel={t("settings:dataSync.contextBundles.scope")} variant="outlined"
        disabled={!bundles.supported || bundles.busy !== null || bundles.choices.length === 1}
        value={bundles.scope} onChange={bundles.setScope}
        options={bundles.choices.map(choice => ({ value: choice.value, label: label(choice) }))} />} />
    <SettingsRow title={t("settings:dataSync.contextBundles.captureTitle")} description={t("settings:dataSync.contextBundles.captureDescription")}
      control={<Button size="sm" disabled={!bundles.supported || !bundles.selector || bundles.busy !== null} aria-busy={bundles.busy === "capture"}
        onClick={() => void bundles.capture()}>
        {bundles.busy === "capture" ? t("settings:dataSync.contextBundles.capturing") : t("settings:dataSync.contextBundles.capture")}
      </Button>} />
    <SettingsRow title={t("settings:dataSync.contextBundles.history")} description={<span className="block">
      <span className="block">{t("settings:dataSync.contextBundles.historyDescription")}</span>
      {bundles.history.status === "loading" && <Spinner size="sm" />}
      {failure && <InlineError compact onRetry={failure.retryable ? bundles.retry : undefined} retryLabel={t("common:errorBoundary.retry")}>{failure.body}</InlineError>}
      {bundles.history.status === "ready" && bundles.history.page.items.length === 0 && <span className="mt-1 block">{t("settings:dataSync.contextBundles.noVersions")}</span>}
      {bundles.history.status === "ready" && bundles.history.page.items.length > 0 && <ul className="mt-2 flex flex-col gap-1.5" aria-label={t("settings:dataSync.contextBundles.history")}>
        {bundles.history.page.items.map(item => <li key={item.version} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="min-w-0">
            <span className="font-mono text-xs text-fg">{shortContextBundleVersion(item.version)}</span>
            <span className="ml-2 text-xs text-fg-muted">{formatDate(new Date(item.publishedAt), { dateStyle: "medium", timeStyle: "short" })}</span>
          </span>
          <Button variant="outline" size="sm" disabled={bundles.busy !== null} aria-busy={bundles.busy === `save:${item.version}`}
            onClick={() => void bundles.save(item.version)}>
            {bundles.busy === `save:${item.version}` ? t("settings:dataSync.contextBundles.saving") : t("settings:dataSync.contextBundles.save")}
          </Button>
        </li>)}
      </ul>}
    </span>} />
  </SettingsGroup>;
}
