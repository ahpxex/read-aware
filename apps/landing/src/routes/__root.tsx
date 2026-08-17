import { HeadContent, Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { title: "ReadAware — A reader aware of you" },
      {
        name: "description",
        content:
          "An aware, extensible reading app. One reader for EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML, and PDF that builds memory from your reading, grows through plugins, and syncs end-to-end encrypted — local-first and private.",
      },
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
