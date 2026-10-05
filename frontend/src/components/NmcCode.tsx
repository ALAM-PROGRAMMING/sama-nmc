import { parseNmc } from "@/lib/nmc";

const SIZE = {
  sm: "text-[13px]",
  md: "text-[15px]",
  lg: "text-[22px]",
  xl: "text-[clamp(20px,5.2vw,34px)]",
} as const;

/**
 * National Material Code in IBM Plex Mono. The 7-digit serial is heaviest, the check digit is blue.
 * Never wrapped, never truncated.
 */
export function NmcCode({ code, size = "md", onDark = false }: { code: string; size?: keyof typeof SIZE; onDark?: boolean }) {
  const p = parseNmc(code);
  if (!p) return <span className={`whitespace-nowrap font-mono ${SIZE[size]}`}>{code}</span>;
  const muted = onDark ? "text-onnavy" : "text-ink-3";
  const mid = onDark ? "text-onnavy" : "text-ink-2";
  const serial = onDark ? "text-white" : "text-ink";
  const check = onDark ? "text-blue-100" : "text-blue-600";
  return (
    <span className={`inline-block whitespace-nowrap font-mono font-medium ${SIZE[size]}`} aria-label={`National material code ${code}`}>
      <span className={muted}>{p.authority}</span>
      <span className={mid}>{p.classCode}-</span>
      <span className={`font-semibold ${serial}`}>{p.serial}</span>
      <span className={mid}>-</span>
      <span className={`font-semibold ${check}`}>{p.check}</span>
    </span>
  );
}
