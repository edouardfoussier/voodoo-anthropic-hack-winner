import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import appCss from "../styles.css?url";
import { ThemeProvider } from "@/components/theme-provider";
import { GameProvider } from "@/lib/game-context";
import { PipelineRunsProvider } from "@/lib/pipeline-runs-context";
import { FloatingRunPill } from "@/components/insights/FloatingRunPill";

const queryClient = new QueryClient();

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Voodoo — Mobile Ad Intelligence" },
      { name: "description", content: "Track competitor creatives, performance signals, and spend across mobile gaming ad networks." },
      { name: "author", content: "Voodoo" },
      { property: "og:title", content: "Voodoo — Mobile Ad Intelligence" },
      { property: "og:description", content: "Track competitor creatives, performance signals, and spend across mobile gaming ad networks." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Voodoo — Mobile Ad Intelligence" },
      { name: "twitter:description", content: "Track competitor creatives, performance signals, and spend across mobile gaming ad networks." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/9e341871-14a0-4c1c-9737-a826411f8fa5/id-preview-4d6b8874--2f77d144-f6a5-4863-8019-9a7963840a57.lovable.app-1777127985065.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/9e341871-14a0-4c1c-9737-a826411f8fa5/id-preview-4d6b8874--2f77d144-f6a5-4863-8019-9a7963840a57.lovable.app-1777127985065.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <QueryClientProvider client={queryClient}>
      <GameProvider>
        <PipelineRunsProvider>
          <ThemeProvider>
            <Outlet />
            {/* Persistent bottom-right indicator for the active pipeline
                run. Survives navigation; only renders when a run exists
                and the dialog is closed. See pipeline-runs-context.tsx. */}
            <FloatingRunPill />
          </ThemeProvider>
        </PipelineRunsProvider>
      </GameProvider>
    </QueryClientProvider>
  );
}
