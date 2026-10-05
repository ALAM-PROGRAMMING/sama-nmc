import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "quiet";
type Size = "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ctl border font-semibold no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const VARIANT: Record<Variant, string> = {
  primary: "border-navy bg-navy text-white hover:bg-navy-800 hover:text-white",
  secondary: "border-navy bg-white text-navy hover:bg-blue-50 hover:text-navy",
  quiet: "border-transparent bg-transparent text-blue-700 hover:bg-blue-50",
};
const SIZE: Record<Size, string> = { md: "h-9 px-3.5 text-sm", lg: "h-11 px-5 text-[15px]" };

function cls(variant: Variant, size: Size, extra?: string) {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${extra ?? ""}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: { variant?: Variant; size?: Size; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cls(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  download,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
  download?: boolean;
}) {
  if (download) {
    return (
      <a href={href} download className={cls(variant, size, className)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls(variant, size, className)}>
      {children}
    </Link>
  );
}
