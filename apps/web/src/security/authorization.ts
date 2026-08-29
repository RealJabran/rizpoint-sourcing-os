import type { OrganizationRole } from "@rizpoint/database";

export const SECURITY_PERMISSIONS = [
  "MANAGE_ORGANIZATION",
  "MANAGE_USERS",
  "MANAGE_PROVIDER_CONNECTIONS",
  "MANAGE_PROVIDER_CREDENTIALS",
  "RUN_RESEARCH",
  "RUN_WHOLESALE_SCAN",
  "VIEW_RESEARCH",
  "VIEW_FINANCIALS",
  "EXPORT_DATA",
  "MANAGE_SECURITY",
  "VIEW_AUDIT_LOG",
] as const;

export type SecurityPermission = (typeof SECURITY_PERMISSIONS)[number];

const ownerPermissions = new Set<SecurityPermission>(SECURITY_PERMISSIONS);
const adminPermissions = new Set<SecurityPermission>(SECURITY_PERMISSIONS);
adminPermissions.delete("MANAGE_ORGANIZATION");
const researcherPermissions = new Set<SecurityPermission>([
  "RUN_RESEARCH",
  "RUN_WHOLESALE_SCAN",
  "VIEW_RESEARCH",
  "VIEW_FINANCIALS",
  "EXPORT_DATA",
]);
const viewerPermissions = new Set<SecurityPermission>(["VIEW_RESEARCH"]);

export const ROLE_PERMISSIONS: Readonly<
  Record<OrganizationRole, ReadonlySet<SecurityPermission>>
> = {
  OWNER: ownerPermissions,
  ADMIN: adminPermissions,
  RESEARCHER: researcherPermissions,
  VIEWER: viewerPermissions,
};

export function permissionsForRole(
  role: OrganizationRole,
): SecurityPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function roleHasPermission(
  role: OrganizationRole,
  permission: SecurityPermission,
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

type PermissionRule = {
  pattern: RegExp;
  methods?: ReadonlySet<string>;
  permission: SecurityPermission;
};

const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const permissionRules: PermissionRule[] = [
  {
    // Authenticated users must be able to inspect and secure their own account
    // regardless of their organization role. Each handler still scopes the
    // operation to the injected organization and user principal.
    pattern: /^\/api\/security\/(status|password|sessions)(?:\/|$)/u,
    permission: "VIEW_RESEARCH",
  },
  {
    pattern:
      /^\/api\/security\/(users|access-reviews|credentials|audit|operations)/u,
    permission: "MANAGE_SECURITY",
  },
  {
    pattern: /^\/api\/providers\/(amazon|market-history)(?:\/|$)/u,
    methods: mutating,
    permission: "MANAGE_PROVIDER_CONNECTIONS",
  },
  {
    pattern: /^\/api\/providers\/(data-rights|health)/u,
    permission: "MANAGE_PROVIDER_CREDENTIALS",
  },
  {
    pattern: /^\/api\/(exports|.*\/exports)(?:\/|$)/u,
    permission: "EXPORT_DATA",
  },
  {
    pattern:
      /^\/api\/(private-label-profitability|portfolio-optimizer|financial-policy)/u,
    permission: "VIEW_FINANCIALS",
  },
  {
    pattern: /^\/api\/(uploads|suppliers|scans|mock-scans)/u,
    methods: mutating,
    permission: "RUN_WHOLESALE_SCAN",
  },
  {
    pattern: /^\/api\/(purchase-orders|shortlists|analysis-views|results)/u,
    methods: mutating,
    permission: "RUN_WHOLESALE_SCAN",
  },
  {
    pattern: /^\/api\/(purchase-orders|results)(?:\/|$)/u,
    permission: "VIEW_FINANCIALS",
  },
];

export function requiredPermissionForRequest(
  pathname: string,
  method: string,
): SecurityPermission {
  const normalizedMethod = method.toUpperCase();
  for (const rule of permissionRules) {
    if (
      rule.pattern.test(pathname) &&
      (!rule.methods || rule.methods.has(normalizedMethod))
    )
      return rule.permission;
  }
  if (["GET", "HEAD", "OPTIONS"].includes(normalizedMethod))
    return "VIEW_RESEARCH";
  return "RUN_RESEARCH";
}
