"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  KeyRound,
  LockKeyhole,
  Plus,
  RotateCcw,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  SelectControl,
  Skeleton,
  TextInput,
  useToast,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";

type SecurityStatus = {
  own: {
    id: string;
    email: string;
    name: string;
    role: string;
    passwordChangedAt: string;
    passwordExpiresAt: string;
    passwordAgeDays: number;
    passwordExpiresInDays: number;
    mfaEnabled: boolean;
    recoveryCodesRemaining: number;
    lastAuthenticatedAt: string | null;
    activeSessions: Array<{
      id: string;
      createdAt: string;
      lastSeenAt: string;
      expiresAt: string;
    }>;
  };
  organization: null | {
    users: Array<{
      membershipId: string;
      userId: string;
      email: string;
      name: string;
      role: "OWNER" | "ADMIN" | "RESEARCHER" | "VIEWER";
      permissions: string[];
      active: boolean;
      mfaEnabled: boolean;
      lastLogin: string | null;
      accountCreatedAt: string;
      lastAccessReviewAt: string | null;
      accessReviewDue: boolean;
    }>;
  };
  providerCredentialHealth: null | {
    state: string;
    keyVersion: number | null;
    connectedAt: string | null;
    revokedAt: string | null;
    rotations: Array<{
      type: string;
      rotatedAt: string;
      nextDueAt: string;
      overdue: boolean;
    }>;
  };
  operations: null | {
    controls: Array<{
      controlType: string;
      maximumAgeDays: number;
      lastPerformedAt: string | null;
      nextDueAt: string | null;
      result: string | null;
      overdue: boolean;
    }>;
    openAlerts: Array<{
      id: string;
      alertType: string;
      severity: string;
      observedAt: string;
    }>;
    openIncidents: Array<{
      id: string;
      reference: string;
      severity: string;
      detectedAt: string;
      amazonNotificationDueAt: string | null;
      amazonNotifiedAt: string | null;
    }>;
  };
  audit: Array<{
    id: string;
    eventType: string;
    outcome: string;
    source: string;
    actorUserId: string | null;
    targetUserId: string | null;
    createdAt: string;
    retentionUntil: string;
  }>;
};

function date(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Never";
}

export function SecurityWorkspace() {
  const { notify } = useToast();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [reviewUser, setReviewUser] = useState<
    NonNullable<SecurityStatus["organization"]>["users"][number] | null
  >(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/security/status", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("SECURITY_STATUS_UNAVAILABLE");
      setStatus((await response.json()) as SecurityStatus);
      setError(null);
    } catch {
      setError(
        "Security status requires an authenticated production account. Local demo mode does not impersonate an approved user.",
      );
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function mutate(url: string, method: string, body: unknown) {
    setBusy(true);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "SECURITY_ACTION_FAILED");
      notify("Security change recorded", "success");
      await load();
      return true;
    } catch (cause) {
      notify(
        cause instanceof Error
          ? `Security change failed: ${cause.message}`
          : "Security change failed. Try again.",
        "danger",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createUser(form: FormData) {
    const created = await mutate("/api/security/users", "POST", {
      email: String(form.get("email") ?? ""),
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
      role: String(form.get("role") ?? "VIEWER"),
      temporaryPassword: String(form.get("temporaryPassword") ?? ""),
    });
    if (created) setUserDialogOpen(false);
  }

  async function completeReview(form: FormData) {
    if (!reviewUser) return;
    const decision = String(form.get("decision") ?? "APPROVED");
    const reviewed = await mutate("/api/security/access-reviews", "POST", {
      subjectUserId: reviewUser.userId,
      decision,
      ...(decision === "CHANGE_ROLE"
        ? { requestedRole: String(form.get("requestedRole") ?? "VIEWER") }
        : {}),
      reason: String(form.get("reason") ?? ""),
    });
    if (reviewed) setReviewUser(null);
  }

  if (!status && !error)
    return (
      <main className="security-workspace">
        <Skeleton className="security-page-skeleton" />
      </main>
    );

  if (!status)
    return (
      <main className="security-workspace">
        <PageHeader
          kicker="Identity & access"
          title="Security"
          description="Application-enforced access controls for RizPoint and Amazon evidence."
        />
        <Alert title="Authenticated security context required" tone="warning">
          {error}
        </Alert>
      </main>
    );

  return (
    <main className="security-workspace">
      <PageHeader
        kicker="Identity & access"
        title="Security"
        description="Review your account, active sessions, least-privilege access, and Amazon credential health."
        actions={
          status.organization ? (
            <Button onClick={() => setUserDialogOpen(true)}>
              <Plus aria-hidden="true" /> Add individual user
            </Button>
          ) : undefined
        }
      />

      <section
        className="security-overview"
        aria-label="Account security status"
      >
        <Card className="security-status-card security-status-card--primary">
          <ShieldCheck aria-hidden="true" />
          <div>
            <span>MFA status</span>
            <strong>
              {status.own.mfaEnabled ? "Protected" : "Action required"}
            </strong>
          </div>
          <Badge tone={status.own.mfaEnabled ? "success" : "danger"}>
            {status.own.mfaEnabled ? "TOTP active" : "Not enrolled"}
          </Badge>
        </Card>
        <Card className="security-status-card">
          <KeyRound aria-hidden="true" />
          <div>
            <span>Password age</span>
            <strong>{status.own.passwordAgeDays} days</strong>
          </div>
          <small>Expires in {status.own.passwordExpiresInDays} days</small>
        </Card>
        <Card className="security-status-card">
          <LockKeyhole aria-hidden="true" />
          <div>
            <span>Recovery codes</span>
            <strong>{status.own.recoveryCodesRemaining}</strong>
          </div>
          <small>Unused, individually hashed</small>
        </Card>
        <Card className="security-status-card">
          <Clock3 aria-hidden="true" />
          <div>
            <span>Active sessions</span>
            <strong>{status.own.activeSessions.length}</strong>
          </div>
          <small>15-minute idle lock</small>
        </Card>
      </section>

      <div className="security-grid">
        <Card className="security-panel">
          <header>
            <div>
              <span className="page-kicker">Your account</span>
              <h2>Security controls</h2>
            </div>
            <Badge tone="info">{status.own.role}</Badge>
          </header>
          <dl className="security-definition-list">
            <div>
              <dt>Individual identity</dt>
              <dd>
                {status.own.name}
                <small>{status.own.email}</small>
              </dd>
            </div>
            <div>
              <dt>Last successful login</dt>
              <dd>{date(status.own.lastAuthenticatedAt)}</dd>
            </div>
            <div>
              <dt>Password expiration</dt>
              <dd>{date(status.own.passwordExpiresAt)}</dd>
            </div>
          </dl>
          <details className="security-form-disclosure">
            <summary>Change password</summary>
            <form
              action={async (form) => {
                const changed = await mutate(
                  "/api/security/password/change",
                  "POST",
                  {
                    currentPassword: String(form.get("currentPassword") ?? ""),
                    newPassword: String(form.get("newPassword") ?? ""),
                  },
                );
                if (changed) window.location.assign("/api/auth/signout");
              }}
            >
              <Field label="Current password">
                <TextInput
                  required
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                />
              </Field>
              <Field
                label="New password"
                hint="14+ characters; upper, lower, number, special; no identity terms."
              >
                <TextInput
                  required
                  minLength={14}
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                />
              </Field>
              <Button disabled={busy} type="submit">
                Change password and revoke sessions
              </Button>
            </form>
          </details>
        </Card>

        <Card className="security-panel">
          <header>
            <div>
              <span className="page-kicker">Session control</span>
              <h2>Active sessions</h2>
            </div>
          </header>
          <div className="security-session-list">
            {status.own.activeSessions.map((session, index) => (
              <article key={session.id}>
                <div>
                  <strong>
                    {index === 0
                      ? "Current or most recent session"
                      : "RizPoint session"}
                  </strong>
                  <small>Last active {date(session.lastSeenAt)}</small>
                </div>
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      `/api/security/sessions/${session.id}`,
                      "DELETE",
                      {},
                    )
                  }
                >
                  Revoke
                </Button>
              </article>
            ))}
          </div>
        </Card>
      </div>

      {status.organization ? (
        <>
          <Card className="security-panel security-users-panel">
            <header>
              <div>
                <span className="page-kicker">Quarterly access review</span>
                <h2>Organization users</h2>
                <p>
                  Every person has an individual identity, explicit role,
                  effective permissions, and review evidence.
                </p>
              </div>
              <Badge
                tone={
                  status.organization.users.some((user) => user.accessReviewDue)
                    ? "warning"
                    : "success"
                }
              >
                {
                  status.organization.users.filter(
                    (user) => user.accessReviewDue,
                  ).length
                }{" "}
                due
              </Badge>
            </header>
            <div className="security-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>MFA</th>
                    <th>Last login</th>
                    <th>Access review</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {status.organization.users.map((user) => (
                    <tr key={user.membershipId}>
                      <td>
                        <strong>{user.name}</strong>
                        <small>{user.email}</small>
                      </td>
                      <td>
                        <Badge tone="info">{user.role}</Badge>
                        <small>{user.permissions.length} permissions</small>
                      </td>
                      <td>
                        {user.mfaEnabled ? (
                          <span className="security-inline-state security-inline-state--ok">
                            <CheckCircle2 aria-hidden="true" /> Active
                          </span>
                        ) : (
                          <span className="security-inline-state security-inline-state--risk">
                            <AlertTriangle aria-hidden="true" /> Missing
                          </span>
                        )}
                      </td>
                      <td>{date(user.lastLogin)}</td>
                      <td>
                        <Badge
                          tone={user.accessReviewDue ? "warning" : "success"}
                        >
                          {user.accessReviewDue ? "Due" : "Current"}
                        </Badge>
                        <small>{date(user.lastAccessReviewAt)}</small>
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setReviewUser(user)}
                        >
                          Review access
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="security-grid">
            <Card className="security-panel">
              <header>
                <div>
                  <span className="page-kicker">Operational assurance</span>
                  <h2>Security maintenance</h2>
                </div>
                <Badge
                  tone={
                    status.operations?.controls.some(
                      (control) => control.overdue,
                    )
                      ? "warning"
                      : "success"
                  }
                >
                  {status.operations?.controls.filter(
                    (control) => control.overdue,
                  ).length ?? 0}{" "}
                  due
                </Badge>
              </header>
              <div className="security-audit-list">
                {status.operations?.controls.slice(0, 6).map((control) => (
                  <article key={control.controlType}>
                    {control.overdue ? (
                      <AlertTriangle aria-hidden="true" />
                    ) : (
                      <CheckCircle2 aria-hidden="true" />
                    )}
                    <div>
                      <strong>
                        {control.controlType.replaceAll("_", " ")}
                      </strong>
                      <small>
                        {control.overdue
                          ? "Evidence required"
                          : `Next due ${date(control.nextDueAt)}`}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
              <small>
                Records require a named reviewer and evidence; passing time
                never marks a control complete.
              </small>
            </Card>
            <Card className="security-panel">
              <header>
                <div>
                  <span className="page-kicker">Amazon SP-API</span>
                  <h2>Provider credential health</h2>
                </div>
                <Badge
                  tone={
                    status.providerCredentialHealth?.state === "ACTIVE"
                      ? "success"
                      : "warning"
                  }
                >
                  {status.providerCredentialHealth?.state ?? "Not connected"}
                </Badge>
              </header>
              <dl className="security-definition-list">
                <div>
                  <dt>Encrypted envelope</dt>
                  <dd>
                    AES-256-GCM · key v
                    {status.providerCredentialHealth?.keyVersion ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt>Access tokens</dt>
                  <dd>Worker memory only</dd>
                </div>
                <div>
                  <dt>Annual rotation evidence</dt>
                  <dd>
                    {status.providerCredentialHealth?.rotations.length ?? 0}{" "}
                    recorded
                  </dd>
                </div>
              </dl>
            </Card>
            <Card className="security-panel">
              <header>
                <div>
                  <span className="page-kicker">Security evidence</span>
                  <h2>Recent audit events</h2>
                </div>
                <Badge tone="neutral">{status.audit.length}</Badge>
              </header>
              <div className="security-audit-list">
                {status.audit.slice(0, 8).map((event) => (
                  <article key={event.id}>
                    <ShieldCheck aria-hidden="true" />
                    <div>
                      <strong>{event.eventType.replaceAll("_", " ")}</strong>
                      <small>{date(event.createdAt)}</small>
                    </div>
                  </article>
                ))}
              </div>
            </Card>
            <Card className="security-panel">
              <header>
                <div>
                  <span className="page-kicker">Response queue</span>
                  <h2>Security alerts & incidents</h2>
                </div>
                <Badge
                  tone={
                    (status.operations?.openAlerts.length ?? 0) +
                      (status.operations?.openIncidents.length ?? 0) >
                    0
                      ? "danger"
                      : "success"
                  }
                >
                  {(status.operations?.openAlerts.length ?? 0) +
                    (status.operations?.openIncidents.length ?? 0)}{" "}
                  open
                </Badge>
              </header>
              <div className="security-audit-list">
                {status.operations?.openIncidents.map((incident) => (
                  <article key={incident.id}>
                    <AlertTriangle aria-hidden="true" />
                    <div>
                      <strong>
                        {incident.reference} ·{" "}
                        {incident.severity.replace("_", "-")}
                      </strong>
                      <small>
                        Detected {date(incident.detectedAt)}
                        {incident.amazonNotificationDueAt &&
                        !incident.amazonNotifiedAt
                          ? ` · Amazon deadline ${date(incident.amazonNotificationDueAt)}`
                          : ""}
                      </small>
                    </div>
                  </article>
                ))}
                {status.operations?.openAlerts.slice(0, 6).map((alert) => (
                  <article key={alert.id}>
                    <AlertTriangle aria-hidden="true" />
                    <div>
                      <strong>{alert.alertType.replaceAll("_", " ")}</strong>
                      <small>
                        {alert.severity} · {date(alert.observedAt)}
                      </small>
                    </div>
                  </article>
                ))}
                {!status.operations?.openAlerts.length &&
                !status.operations?.openIncidents.length ? (
                  <article>
                    <CheckCircle2 aria-hidden="true" />
                    <div>
                      <strong>No open security response items</strong>
                      <small>Monitoring remains active.</small>
                    </div>
                  </article>
                ) : null}
              </div>
            </Card>
          </div>
        </>
      ) : null}

      {userDialogOpen ? (
        <div className="rp-dialog-layer">
          <button
            className="rp-dialog-scrim"
            aria-label="Close add user"
            onClick={() => setUserDialogOpen(false)}
          />
          <section
            className="rp-dialog security-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-user-title"
          >
            <header>
              <Users aria-hidden="true" />
              <div>
                <span className="page-kicker">Unique account</span>
                <h2 id="add-user-title">Add an organization user</h2>
              </div>
            </header>
            <form action={createUser}>
              <div className="security-form-grid">
                <Field label="First name">
                  <TextInput required name="firstName" />
                </Field>
                <Field label="Last name">
                  <TextInput required name="lastName" />
                </Field>
              </div>
              <Field label="Work email">
                <TextInput required name="email" type="email" />
              </Field>
              <Field label="Role">
                <SelectControl name="role" defaultValue="RESEARCHER">
                  <option value="ADMIN">Admin</option>
                  <option value="RESEARCHER">Researcher</option>
                  <option value="VIEWER">Viewer</option>
                  <option value="OWNER">Owner</option>
                </SelectControl>
              </Field>
              <Field
                label="Temporary password"
                hint="Must meet full policy; user must replace it before access."
              >
                <TextInput
                  required
                  minLength={14}
                  name="temporaryPassword"
                  type="password"
                  autoComplete="new-password"
                />
              </Field>
              <footer>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setUserDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button disabled={busy} type="submit">
                  <UserRoundCheck aria-hidden="true" /> Create individual
                  account
                </Button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}

      {reviewUser ? (
        <div className="rp-dialog-layer">
          <button
            className="rp-dialog-scrim"
            aria-label="Close access review"
            onClick={() => setReviewUser(null)}
          />
          <section
            className="rp-dialog security-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-user-title"
          >
            <header>
              <ShieldCheck aria-hidden="true" />
              <div>
                <span className="page-kicker">Quarterly evidence</span>
                <h2 id="review-user-title">Review {reviewUser.name}</h2>
              </div>
            </header>
            <form action={completeReview}>
              <Field label="Decision">
                <SelectControl name="decision" defaultValue="APPROVED">
                  <option value="APPROVED">Approve current access</option>
                  <option value="CHANGE_ROLE">Change role</option>
                  <option value="REMOVE_ACCESS">
                    Remove access immediately
                  </option>
                </SelectControl>
              </Field>
              <Field label="Role if changing">
                <SelectControl
                  name="requestedRole"
                  defaultValue={reviewUser.role}
                >
                  <option value="OWNER">Owner</option>
                  <option value="ADMIN">Admin</option>
                  <option value="RESEARCHER">Researcher</option>
                  <option value="VIEWER">Viewer</option>
                </SelectControl>
              </Field>
              <Field label="Reason">
                <TextInput
                  required
                  minLength={3}
                  name="reason"
                  placeholder="Evidence for this review decision"
                />
              </Field>
              <footer>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setReviewUser(null)}
                >
                  Cancel
                </Button>
                <Button disabled={busy} type="submit">
                  <RotateCcw aria-hidden="true" /> Record review
                </Button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
