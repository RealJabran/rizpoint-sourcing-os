import type { ReactNode } from "react";
import type { NavigationIcon } from "./navigation";

export function NavGlyph({ name }: { name: NavigationIcon }) {
  const paths: Record<NavigationIcon, ReactNode> = {
    dashboard: <path d="M4 4h6v6H4zM14 4h6v10h-6zM4 14h6v6H4zM14 18h6v2h-6z" />,
    scan: <path d="M5 3h10l4 4v14H5zM15 3v5h5M8 12h8M8 16h8" />,
    analysis: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    explorer: <path d="M4 4h16v16H4zM8 14l3-3 2 2 4-5M8 8h.01" />,
    category: <path d="M4 5h6v5H4zM14 5h6v5h-6zM9 17h6M7 10v3h10v-3M12 13v4" />,
    opportunity: (
      <path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.8-5.4 2.8 1-6.1-4.4-4.3 6.1-.9z" />
    ),
    demand: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2M4 9l6-4 6 7 5-6" />,
    shortlist: <path d="M5 5h14M5 12h14M5 19h14M2 5h.01M2 12h.01M2 19h.01" />,
    order: <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h3" />,
    learn: (
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v17H6.5A2.5 2.5 0 0 0 4 22zM20 5.5A2.5 2.5 0 0 0 17.5 3H12v17h5.5A2.5 2.5 0 0 1 20 22z" />
    ),
    settings: (
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5zM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2 2-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20h-2.8v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2-2 .06-.06A1.7 1.7 0 0 0 7.52 15a1.7 1.7 0 0 0-1.55-1H5.9v-2.8h.07a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2-2 .06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V5h2.8v.11a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2 2-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.55 1h.07V14h-.07a1.7 1.7 0 0 0-1.55 1z" />
    ),
  };
  return (
    <svg
      className="nav-glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
