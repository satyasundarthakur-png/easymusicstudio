import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const VjClient = lazy(() => import("../vj/VjClient"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VJ Studio — Live Performance Surface" },
      {
        name: "description",
        content:
          "A live visual/audio performance surface: real-time visual engine, audio analysis, MIDI control, and AI-assisted composition.",
      },
      { property: "og:title", content: "VJ Studio — Live Performance Surface" },
      {
        property: "og:description",
        content:
          "Real-time VJ performance surface with audio engine, visual engine, MIDI, and AI-assisted composition tools.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Loading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#030107",
        color: "#85818f",
        fontFamily: "'DM Mono', ui-monospace, monospace",
        fontSize: 12,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
      }}
    >
      Booting performance surface…
    </div>
  );
}

function Index() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <VjClient />
      </Suspense>
    </ClientOnly>
  );
}
