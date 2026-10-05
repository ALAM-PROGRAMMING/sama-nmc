import type { Metadata } from "next";
import { ButtonLink } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="space-y-5">
      <h1 className="text-[28px]">Page not found</h1>
      <EmptyState
        title="We could not find that page."
        action={
          <>
            <ButtonLink href="/" size="lg">Go to the overview</ButtonLink>
            <ButtonLink href="/materials" variant="secondary" size="lg">Material Master</ButtonLink>
          </>
        }
      >
        The link may be old or mistyped. Your loaded run, if any, is still in this tab.
      </EmptyState>
    </div>
  );
}
