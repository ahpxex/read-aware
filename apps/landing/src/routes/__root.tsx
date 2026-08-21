import { HeadContent, Outlet, createRootRoute } from "@tanstack/react-router";
import { HOME } from "../lib/home-content";

// The default head is the English homepage's — routes with their own head()
// override it. Keep index.html's static <title>/<meta> in step with HOME.en.
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { title: HOME.en.metaTitle },
      { name: "description", content: HOME.en.metaDescription },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  );
}
