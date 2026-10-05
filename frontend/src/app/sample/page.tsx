import type { Metadata } from "next";
import { SampleView } from "./SampleView";

export const metadata: Metadata = { title: "Sample data" };

export default function Page() {
  return <SampleView />;
}
