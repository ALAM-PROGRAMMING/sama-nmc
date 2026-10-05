import type { ReactNode, SVGProps } from "react";

export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.4" /><path d="M5 8.2l2 2L11 6" /></Svg>
);
export const FlagIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 14V2.5" /><path d="M4 3h7.5l-1.6 2.7 1.6 2.8H4" /></Svg>
);
export const CrossIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.4" /><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" /></Svg>
);
export const CircleIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.4" /><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" /></Svg>
);
export const PendingIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.4" strokeDasharray="2.4 2.4" /></Svg>
);
export const InfoIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.4" /><path d="M8 7.2v3.6" /><circle cx="8" cy="5.2" r="0.5" fill="currentColor" /></Svg>
);
export const UploadIcon = (p: IconProps) => (
  <Svg {...p}><path d="M8 11V2.8M4.8 5.8L8 2.6l3.2 3.2" /><path d="M2.5 11v2.5h11V11" /></Svg>
);
export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}><path d="M8 2.6v8.2M4.8 7.8L8 11l3.2-3.2" /><path d="M2.5 11v2.5h11V11" /></Svg>
);
export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}><path d="M8 1.8l5 1.8v4c0 3-2.1 5-5 6.4-2.9-1.4-5-3.4-5-6.4v-4z" /><path d="M5.8 8l1.6 1.6L10.4 6.5" /></Svg>
);
export const LockIcon = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="7" width="10" height="6.8" rx="1" /><path d="M5.2 7V5a2.8 2.8 0 015.6 0v2" /></Svg>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2.8 8h10M9 4l4 4-4 4" /></Svg>
);
export const FileIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3.5 1.8h5.6l3.4 3.4v9H3.5z" /><path d="M9 1.8v3.6h3.5" /></Svg>
);
export const PlayIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4.6 2.8l8 5.2-8 5.2z" fill="currentColor" /></Svg>
);
export const ResetIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2.8 8a5.2 5.2 0 105.2-5.2c-1.7 0-3.1.8-4 2" /><path d="M2.6 2.4v3h3" /></Svg>
);
export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5.5 3.5L10 8l-4.5 4.5" /></Svg>
);
export const StarIcon = (p: IconProps) => (
  <Svg {...p}><path d="M8 1.9l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.1 4.4 13l.7-4L2.2 6.2l4-.6z" fill="currentColor" /></Svg>
);
export const MenuIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="7" cy="7" r="4.4" /><path d="M10.4 10.4L14 14" /></Svg>
);
/* navigation glyphs */
export const HomeIcon = (p: IconProps) => (
  <Svg {...p}><path d="M2.5 7.5L8 2.8l5.5 4.7" /><path d="M4 6.8v6.7h8V6.8" /></Svg>
);
export const TableIcon = (p: IconProps) => (
  <Svg {...p}><rect x="2.2" y="3" width="11.6" height="10" rx="0.8" /><path d="M2.2 6.6h11.6M2.2 10h11.6M6.2 6.6V13" /></Svg>
);
export const BookIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3.2 2.5h8.3a1.3 1.3 0 011.3 1.3v9.7H4.5a1.3 1.3 0 01-1.3-1.3z" /><path d="M3.2 12.2a1.3 1.3 0 011.3-1.3h8.3" /></Svg>
);
export const BarsIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 13.5V8M8 13.5V2.8M13 13.5V6" /></Svg>
);
