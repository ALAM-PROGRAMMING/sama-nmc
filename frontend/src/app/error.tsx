"use client";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    document.title = "Something went wrong · SAMA-NMC";
    console.error(error); // kept in the console for engineers; never shown on the page
  }, [error]);
  return (
    <div className="space-y-5">
      <h1 className="text-[28px]">Something went wrong</h1>
      <EmptyState
        title="This page could not be shown."
        action={
          <>
            <Button size="lg" onClick={reset}>Try again</Button>
            <ButtonLink href="/" variant="secondary" size="lg">Go to the overview</ButtonLink>
          </>
        }
      >
        Nothing was lost on your side and no data was sent anywhere. Try again, or start over from the overview.
      </EmptyState>
    </div>
  );
}
