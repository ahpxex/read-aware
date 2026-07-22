import { Outlet, createFileRoute } from "@tanstack/react-router";
import { DocsNav } from "../components/DocsNav";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
});

function DocsLayout() {
  return (
    <div className="min-h-screen bg-paper text-fg">
      <div className="mx-auto max-w-4xl px-6">
        <SiteHeader />
        <div className="pb-12 pt-6 sm:pt-8 md:grid md:grid-cols-[10.5rem_minmax(0,1fr)] md:gap-12">
          <DocsNav />
          <main className="mt-10 min-w-0 md:mt-0">
            <Outlet />
          </main>
        </div>
        <SiteFooter />
      </div>
    </div>
  );
}
