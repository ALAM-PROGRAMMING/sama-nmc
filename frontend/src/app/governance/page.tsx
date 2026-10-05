import type { Metadata } from "next";
import { GovernanceView } from "./GovernanceView";

export const metadata: Metadata = { title: "Governance" };

export default function Page() {
  return <GovernanceView />;
}
