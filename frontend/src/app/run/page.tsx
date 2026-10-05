import type { Metadata } from "next";
import { Suspense } from "react";
import { RunView } from "./RunView";

export const metadata: Metadata = { title: "Processing" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RunView />
    </Suspense>
  );
}
