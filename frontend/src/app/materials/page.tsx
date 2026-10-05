import type { Metadata } from "next";
import { MaterialsView } from "./MaterialsView";

export const metadata: Metadata = { title: "Material Master" };

export default function Page() {
  return <MaterialsView />;
}
