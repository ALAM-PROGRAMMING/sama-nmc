import type { Metadata } from "next";
import { ReviewView } from "./ReviewView";

export const metadata: Metadata = { title: "Match Review" };

export default function Page() {
  return <ReviewView />;
}
