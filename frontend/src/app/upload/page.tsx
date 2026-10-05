import type { Metadata } from "next";
import { UploadView } from "./UploadView";

export const metadata: Metadata = { title: "Upload" };

export default function Page() {
  return <UploadView />;
}
