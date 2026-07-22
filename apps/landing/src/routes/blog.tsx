import { Outlet, createFileRoute } from "@tanstack/react-router";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";

export const Route = createFileRoute("/blog")({
  component: BlogLayout,
});

function BlogLayout() {
  return (
    <div className="min-h-screen bg-paper text-fg">
      <div className="mx-auto max-w-3xl px-6">
        <SiteHeader />
        <main className="max-w-[40rem] pb-12 pt-6 sm:pt-8">
          <Outlet />
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
