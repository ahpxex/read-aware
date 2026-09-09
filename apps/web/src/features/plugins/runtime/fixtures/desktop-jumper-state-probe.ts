import { appDataDir } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { createReadingDomain } from "../../../../domain/reading";
import { pluginCommandsAtom } from "../../state/plugin-store";

/** The caller starts the compiled Jumper Worker and supplies a synthetic book. */
export async function runJumperStateProbe(pluginId: string, bookId: string) {
  if (!(await appDataDir()).replace(/[/\\]$/, "").endsWith("/com.readaware.app.capability-e2e")) throw Error("Use isolated capability-e2e app");
  const reading = createReadingDomain("user");
  const commands = () => getDefaultStore().get(pluginCommandsAtom).filter(command => command.pluginId === pluginId);
  const states = () => Object.fromEntries(commands().map(command => [command.id, command.state?.enabled]));
  const until = async (stage: string, expectedReady = true) => {
    const deadline = Date.now() + 8_000;
    while (true) {
      const current = states();
      const session = await reading.queries.session();
      const ready = session.status === "ready";
      if (ready === expectedReady && commands().every(command => command.state?.revision === session.revision + 1)
        && current.back === (ready && session.history.canGoBack) && current.forward === (ready && session.history.canGoForward) && current.open === ready) return current;
      if (Date.now() > deadline) throw Error(`Jumper ${stage} state mismatch: ${JSON.stringify(current)}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const closed = await until("closed", false);
  await reading.commands.openBook(bookId);
  const opened = await until("opened");
  const before = await reading.queries.session();
  await reading.commands.goTo({ bookId, fraction: (before.location?.fraction ?? 0) < 0.5 ? 0.8 : 0.2 });
  const navigated = await until("navigated");
  await commands().find(command => command.id === "back")!.run();
  const back = await until("back");
  await commands().find(command => command.id === "forward")!.run();
  const forward = await until("forward");
  await reading.commands.close();
  const afterClose = await until("afterClose", false);
  await reading.commands.openBook(bookId);
  await until("preview");
  return { closed, opened, navigated, back, forward, afterClose, preview: "reader" };
}
