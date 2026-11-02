import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { children?: ReactNode };

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ShieldCheckIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></Svg>;
}

export function ArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="M12 5v14M5 12h14" /></Svg>;
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></Svg>;
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="m5 12 4 4L19 6" /></Svg>;
}

export function AlertIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="M10.3 4.1 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></Svg>;
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
}

export function ExternalLinkIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="M14 5h5v5M19 5l-8 8" /><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></Svg>;
}

export function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2 5M20 12l-3-3" /></Svg>;
}

export function BoxIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 8 9 5 9-5M3 12l9 5 9-5M3 16l9 5 9-5" /></Svg>;
}

export function EvidenceIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="M6 3h9l4 4v14H6V3Z" /><path d="M14 3v5h5M9 12h6M9 16h6M9 8h2" /></Svg>;
}

export function VerdictIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="M12 3v18M5 6h14M5 6l-3 7h6L5 6ZM19 6l-3 7h6l-3-7ZM8 21h8" /></Svg>;
}

export function CardIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></Svg>;
}

export function SparkIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></Svg>;
}

export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return <Svg {...props}><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></Svg>;
}
