/**
 * The post-upgrade notice — the container half.
 *
 * It owns the reconcile/TTL state machine and the changelog fetch (see
 * `useWhatsNewDialog`); the dialog itself is `WhatsNewDialogView`.
 */
import { useWhatsNewDialog } from "../hooks/useWhatsNewDialog";
import { WhatsNewDialogView } from "./WhatsNewDialogView";

export function WhatsNewDialog() {
  const { version, codename, entry, loading, close } = useWhatsNewDialog();
  return (
    <WhatsNewDialogView
      version={version}
      codename={codename}
      entry={entry}
      loading={loading}
      close={close}
    />
  );
}
