import type { Metadata } from "next";
import { OverviewView } from "./OverviewView";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return <OverviewView />;
}
