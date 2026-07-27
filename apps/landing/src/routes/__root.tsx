import { HeadContent, Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { title: "ReadAware — Reading that remembers" },
      {
        name: "description",
        content:
          "An AI-native reading workspace. Context-rich reading and AI-assisted understanding for EPUB, MOBI, AZW3, FB2, CBZ, CBR, TXT, HTML, and PDF — local-first and private.",
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
