export type NavigationIcon =
  | "dashboard"
  | "scan"
  | "analysis"
  | "explorer"
  | "category"
  | "opportunity"
  | "demand"
  | "shortlist"
  | "order"
  | "learn"
  | "settings";

export type NavigationItem = {
  label: string;
  href: string;
  icon: NavigationIcon;
  keywords?: string[];
};

export type NavigationGroup = {
  label: string;
  icon: NavigationIcon;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    label: "Dashboard",
    icon: "dashboard",
    items: [{ label: "Overview", href: "/", icon: "dashboard" }],
  },
  {
    label: "Wholesale",
    icon: "scan",
    items: [
      { label: "New scan", href: "/uploads", icon: "scan" },
      { label: "Scan list", href: "/scans", icon: "scan" },
      { label: "Analysis", href: "/analysis", icon: "analysis" },
      { label: "Shortlists", href: "/shortlists", icon: "shortlist" },
      { label: "Purchase orders", href: "/purchase-orders", icon: "order" },
    ],
  },
  {
    label: "Product Research",
    icon: "explorer",
    items: [
      {
        label: "Product Explorer",
        href: "/product-explorer",
        icon: "explorer",
      },
      {
        label: "Category intelligence",
        href: "/category-intelligence",
        icon: "category",
      },
      { label: "Sales estimation", href: "/sales-estimation", icon: "demand" },
      {
        label: "Relationships",
        href: "/product-relationships",
        icon: "analysis",
      },
      {
        label: "Review intelligence",
        href: "/review-intelligence",
        icon: "learn",
      },
    ],
  },
  {
    label: "Niches",
    icon: "opportunity",
    items: [
      {
        label: "Opportunity Finder",
        href: "/opportunity-finder",
        icon: "opportunity",
      },
      { label: "Differentiation", href: "/differentiation", icon: "analysis" },
      { label: "Compliance risk", href: "/compliance-risk", icon: "settings" },
      {
        label: "Portfolio optimizer",
        href: "/portfolio-optimizer",
        icon: "analysis",
      },
    ],
  },
  {
    label: "Keywords",
    icon: "learn",
    items: [
      {
        label: "Keyword Explorer",
        href: "/keyword-explorer",
        icon: "explorer",
      },
      { label: "Reverse ASIN", href: "/reverse-asin", icon: "analysis" },
      { label: "Brand Analytics", href: "/brand-analytics", icon: "demand" },
      { label: "Rank tracker", href: "/rank-tracker", icon: "analysis" },
    ],
  },
  {
    label: "Markets",
    icon: "demand",
    items: [
      { label: "Market tracker", href: "/market-tracker", icon: "demand" },
      {
        label: "Advertising intelligence",
        href: "/advertising-intelligence",
        icon: "analysis",
      },
    ],
  },
  {
    label: "Brands & Sellers",
    icon: "category",
    items: [
      {
        label: "Brand intelligence",
        href: "/brand-intelligence",
        icon: "category",
      },
      {
        label: "Seller intelligence",
        href: "/seller-intelligence",
        icon: "analysis",
      },
    ],
  },
  {
    label: "Projects",
    icon: "shortlist",
    items: [
      {
        label: "Research projects",
        href: "/research-projects",
        icon: "shortlist",
      },
      { label: "Research Copilot", href: "/research-copilot", icon: "learn" },
    ],
  },
  {
    label: "Monitoring",
    icon: "analysis",
    items: [
      { label: "Alerts & notifications", href: "/alerts", icon: "analysis" },
    ],
  },
  {
    label: "Launch",
    icon: "order",
    items: [
      {
        label: "Listing analyzer",
        href: "/listing-analyzer",
        icon: "analysis",
      },
      { label: "Listing builder", href: "/listing-builder", icon: "learn" },
      { label: "Launch planner", href: "/launch-planner", icon: "order" },
      {
        label: "Private-label profit",
        href: "/private-label-profitability",
        icon: "demand",
      },
    ],
  },
  {
    label: "Settings",
    icon: "settings",
    items: [{ label: "Learning & help", href: "/learning", icon: "learn" }],
  },
];

export const navigationItems = navigationGroups.flatMap((group) => group.items);

export function routeIsActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
