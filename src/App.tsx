import { useAtom } from "jotai";
import { focusTagAtom, focusTags } from "./state/ui";

const checkItems = [
  "Tailwind utility classes are rendering",
  "Responsive layout is active",
  "Tauri + React shell is ready",
];

const focusCopy = {
  feature: "Feature work can now be modeled with lightweight global state before you build the real reader flows.",
  bug: "Bug triage views can share status across panels without prop drilling once Jotai atoms become your UI backbone.",
  reader: "Reader-level preferences like density, theme, or reading mode fit naturally into small focused atoms.",
  context: "Context state can be split into composable atoms so retrieval, notes, and highlights stay easy to reason about.",
  desktop: "Desktop-specific UI state for Tauri windows and panels can stay local, explicit, and easy to test.",
} satisfies Record<(typeof focusTags)[number], string>;

function App() {
  const [focusTag, setFocusTag] = useAtom(focusTagAtom);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-12">
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-2xl shadow-cyan-950/40 backdrop-blur">
          <div className="border-b border-white/10 bg-gradient-to-r from-cyan-400/20 via-sky-400/10 to-transparent px-8 py-8 sm:px-10">
            <div className="mb-4 flex flex-wrap gap-3 text-xs font-medium uppercase tracking-[0.22em] text-cyan-200/80">
              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1">Tauri</span>
              <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1">React</span>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1">Tailwind CSS</span>
            </div>

            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Tailwind is installed and styling your ReadAware shell.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              This screen uses utility classes only, so if you see the gradient, spacing,
              rounded surfaces, and badges below, the Tailwind setup is working.
            </p>
          </div>

          <div className="grid gap-6 px-8 py-8 sm:px-10 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-400">Installation status</p>
                  <h2 className="mt-1 text-2xl font-semibold text-white">Ready for Tailwind-driven UI work</h2>
                </div>
                <div className="inline-flex items-center rounded-full bg-emerald-400/15 px-3 py-1 text-sm font-medium text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                  Success
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {checkItems.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200 shadow-lg shadow-slate-950/30"
                  >
                    <div className="mb-3 h-2 w-16 rounded-full bg-gradient-to-r from-cyan-400 to-sky-400" />
                    {item}
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                {focusTags.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setFocusTag(chip)}
                    className={
                      focusTag === chip
                        ? "rounded-full border border-cyan-300/30 bg-cyan-300/15 px-3 py-1 text-sm text-cyan-100 transition"
                        : "rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 transition hover:border-cyan-300/20 hover:text-cyan-100"
                    }
                  >
                    #{chip}
                  </button>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm leading-6 text-cyan-50">
                <div className="text-xs font-medium uppercase tracking-[0.22em] text-cyan-200/80">
                  Jotai atom state
                </div>
                <div className="mt-2 text-base font-semibold text-white">Current focus: #{focusTag}</div>
                <p className="mt-2 text-sm text-cyan-50/90">{focusCopy[focusTag]}</p>
              </div>
            </section>

            <aside className="rounded-2xl border border-white/10 bg-slate-900/70 p-6">
              <p className="text-sm font-medium text-slate-400">What changed</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  Added Tailwind’s official Vite plugin.
                </li>
                <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  Added Jotai and connected a simple atom-driven UI state.
                </li>
                <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  Imported Tailwind from a single app-wide stylesheet.
                </li>
                <li className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  Removed the default Tauri starter content.
                </li>
              </ul>

              <div className="mt-6 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-cyan-100">
                Next up, you can start replacing this validation screen with the actual
                reader layout.
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
