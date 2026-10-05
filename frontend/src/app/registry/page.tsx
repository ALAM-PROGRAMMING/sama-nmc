import type { Metadata } from "next";
import { Suspense } from "react";
import { RegistryView } from "./RegistryView";

export const metadata: Metadata = { title: "NMC Registry" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RegistryView />
    </Suspense>
  );
}
