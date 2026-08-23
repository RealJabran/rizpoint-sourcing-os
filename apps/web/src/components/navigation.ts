export type NavigationIcon =
  | "home"
  | "scan"
  | "analysis"
  | "shortlist"
  | "order"
  | "search"
  | "explorer"
  | "category"
  | "keyword"
  | "market"
  | "brand"
  | "seller"
  | "review"
  | "project"
  | "copilot"
  | "product"
  | "alert"
  | "listing"
  | "profit"
  | "shield"
  | "planner"
  | "settings"
  | "database"
  | "history"
  | "learning"
  | "differentiation"
  | "advertising"
  | "relationship"
  | "estimate"
  | "portfolio";

export type NavigationItem = {
  label: string;
  shortLabel?: string;
  href: string;
  icon: NavigationIcon;
  keywords?: string[];
};

export type NavigationGroup = {
  label: string;
  icon: NavigationIcon;
  items: NavigationItem[];
};

/** Product-oriented IA: all routes remain reachable, but adjacent tools are
 * grouped by the decision the user is trying to make rather than by prompt. */
export const navigationGroups: NavigationGroup[] = [
  {
    label: "Home",
    icon: "home",
    items: [{ label: "Home", href: "/", icon: "home" }],
  },
  {
    label: "Sourcing",
    icon: "scan",
    items: [
      { label: "Supplier scans", href: "/uploads", icon: "scan" },
      { label: "Scan history", href: "/scans", icon: "history" },
      { label: "Analysis", href: "/analysis", icon: "analysis" },
      { label: "Shortlists", href: "/shortlists", icon: "shortlist" },
      { label: "Purchase orders", href: "/purchase-orders", icon: "order" },
    ],
  },
  {
    label: "Research",
    icon: "search",
    items: [
      {
        label: "Research product",
        href: "/product-research",
        icon: "search",
        keywords: ["asin", "upc", "catalog search", "amazon url"],
      },
      {
        label: "Product Explorer",
        href: "/product-explorer",
        icon: "explorer",
      },
      {
        label: "Opportunity Finder",
        href: "/opportunity-finder",
        icon: "portfolio",
      },
      {
        label: "Categories",
        href: "/category-intelligence",
        icon: "category",
      },
      { label: "Keywords", href: "/keyword-explorer", icon: "keyword" },
      { label: "Reverse ASIN", href: "/reverse-asin", icon: "relationship" },
      {
        label: "Product relationships",
        href: "/product-relationships",
        icon: "relationship",
      },
      {
        label: "Differentiation",
        href: "/differentiation",
        icon: "differentiation",
      },
      {
        label: "Sales estimation",
        href: "/sales-estimation",
        icon: "estimate",
      },
    ],
  },
  {
    label: "Intelligence",
    icon: "market",
    items: [
      { label: "Markets", href: "/market-tracker", icon: "market" },
      { label: "Brands", href: "/brand-intelligence", icon: "brand" },
      { label: "Sellers", href: "/seller-intelligence", icon: "seller" },
      { label: "Reviews", href: "/review-intelligence", icon: "review" },
      {
        label: "Advertising",
        href: "/advertising-intelligence",
        icon: "advertising",
      },
      { label: "Brand Analytics", href: "/brand-analytics", icon: "analysis" },
    ],
  },
  {
    label: "Projects",
    icon: "project",
    items: [
      {
        label: "Research projects",
        href: "/research-projects",
        icon: "project",
      },
      { label: "Research Copilot", href: "/research-copilot", icon: "copilot" },
    ],
  },
  {
    label: "Monitoring",
    icon: "alert",
    items: [
      { label: "Products", href: "/product-tracker", icon: "product" },
      { label: "Keyword ranks", href: "/rank-tracker", icon: "keyword" },
      { label: "Alerts", href: "/alerts", icon: "alert" },
    ],
  },
  {
    label: "Launch",
    icon: "planner",
    items: [
      {
        label: "Listing analyzer",
        href: "/listing-analyzer",
        icon: "analysis",
      },
      { label: "Listing builder", href: "/listing-builder", icon: "listing" },
      {
        label: "Profitability",
        href: "/private-label-profitability",
        icon: "profit",
      },
      { label: "Compliance", href: "/compliance-risk", icon: "shield" },
      {
        label: "Portfolio allocation",
        href: "/portfolio-optimizer",
        icon: "portfolio",
      },
      { label: "Launch planner", href: "/launch-planner", icon: "planner" },
    ],
  },
  {
    label: "Settings",
    icon: "settings",
    items: [
      {
        label: "Integrations",
        href: "/settings/integrations",
        icon: "settings",
      },
      {
        label: "Market history",
        href: "/settings/integrations/history",
        icon: "history",
      },
      {
        label: "Data & providers",
        href: "/settings/data-providers",
        icon: "database",
      },
      { label: "Learning & help", href: "/learning", icon: "learning" },
    ],
  },
];

export const navigationItems = navigationGroups.flatMap((group) => group.items);

export function routeIsActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function navigationItemForPath(pathname: string) {
  return [...navigationItems]
    .sort((left, right) => right.href.length - left.href.length)
    .find((item) => routeIsActive(pathname, item.href));
}
