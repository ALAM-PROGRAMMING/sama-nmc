import type { Metadata } from "next";
import { AboutView } from "./AboutView";

export const metadata: Metadata = { title: "About this demo" };

export default function Page() {
  return <AboutView />;
}
