import { Tabs } from "../../components";
import { ReadingPanel } from "./components/ReadingPanel";
import { DisplayPanel } from "./components/DisplayPanel";
import { AIContextPanel } from "./components/AIContextPanel";
import { AccountPanel } from "./components/AccountPanel";

export function SettingsView() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-screen-2xl px-6 py-8 sm:py-10">
        <Tabs
          ariaLabel="Settings sections"
          defaultIndex={0}
          variant="nav"
          className="w-full"
          items={[
            { label: "Reading", content: <ReadingPanel /> },
            { label: "Display", content: <DisplayPanel /> },
            { label: "AI Context", content: <AIContextPanel /> },
            { label: "Account", content: <AccountPanel /> },
          ]}
        />
      </div>
    </div>
  );
}
