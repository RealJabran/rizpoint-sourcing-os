"use client";

import { signIn } from "next-auth/react";
import Image from "next/image";
import { useState } from "react";
import { Check, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

type LoginStep = "PASSWORD" | "MFA" | "ENROLL" | "RECOVERY_CODES" | "RESET";

const passwordErrors: Record<string, string> = {
  PASSWORD_TOO_SHORT: "Use at least 14 characters.",
  PASSWORD_UPPERCASE_REQUIRED: "Add at least one uppercase character.",
  PASSWORD_LOWERCASE_REQUIRED: "Add at least one lowercase character.",
  PASSWORD_NUMBER_REQUIRED: "Add at least one number.",
  PASSWORD_SPECIAL_REQUIRED: "Add at least one special character.",
  PASSWORD_CONTAINS_IDENTITY:
    "Do not include your name, email identity, or organization name.",
  PASSWORD_REUSED: "Choose a password not used in your previous ten passwords.",
  PASSWORD_MINIMUM_AGE: "Passwords cannot be changed more than once per day.",
};

export default function LoginPage() {
  const [step, setStep] = useState<LoginStep>("PASSWORD");
  const [challengeToken, setChallengeToken] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/security/login/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      const result = (await response.json()) as {
        status: string;
        challengeToken?: string;
      };
      if (!response.ok || !result.challengeToken) {
        setError(
          result.status === "LOCKED"
            ? "This account is temporarily locked. Try again after the lockout period."
            : "The sign-in details could not be verified.",
        );
        return;
      }
      setChallengeToken(result.challengeToken);
      if (result.status === "MFA_REQUIRED") setStep("MFA");
      if (result.status === "PASSWORD_RESET_REQUIRED") setStep("RESET");
      if (result.status === "MFA_ENROLLMENT_REQUIRED") {
        const enrollmentResponse = await fetch(
          "/api/security/mfa/enrollment/start",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ challengeToken: result.challengeToken }),
          },
        );
        const enrollment = (await enrollmentResponse.json()) as {
          manualKey?: string;
          qrDataUrl?: string;
        };
        if (
          !enrollmentResponse.ok ||
          !enrollment.manualKey ||
          !enrollment.qrDataUrl
        )
          throw new Error("ENROLLMENT_START_FAILED");
        setManualKey(enrollment.manualKey);
        setQrDataUrl(enrollment.qrDataUrl);
        setStep("ENROLL");
      }
    } catch {
      setError(
        "Sign-in is temporarily unavailable. Try again safely in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(form: FormData) {
    setBusy(true);
    setError(null);
    const value = String(form.get("factor") ?? "");
    const result = await signIn("credentials", {
      challengeToken,
      ...(usingRecoveryCode ? { recoveryCode: value } : { mfaCode: value }),
      redirect: false,
      callbackUrl: "/",
    });
    setBusy(false);
    if (result?.error) {
      setError("The security code could not be verified.");
      return;
    }
    window.location.assign(result?.url ?? "/");
  }

  async function confirmEnrollment(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/security/mfa/enrollment/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken,
          code: String(form.get("code") ?? ""),
        }),
      });
      const result = (await response.json()) as { recoveryCodes?: string[] };
      if (!response.ok || !result.recoveryCodes)
        throw new Error("MFA_CODE_INVALID");
      setManualKey("");
      setQrDataUrl("");
      setChallengeToken("");
      setRecoveryCodes(result.recoveryCodes);
      setStep("RECOVERY_CODES");
    } catch {
      setError(
        "That authenticator code was not valid. Check the device time and retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(form: FormData) {
    setBusy(true);
    setError(null);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmation") ?? "")) {
      setBusy(false);
      setError("The password confirmation does not match.");
      return;
    }
    const response = await fetch("/api/security/password/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeToken, password }),
    });
    const result = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(
        passwordErrors[result.error ?? ""] ??
          "The password could not be changed.",
      );
      return;
    }
    setChallengeToken("");
    setStep("PASSWORD");
    setError("Password updated. Sign in again to complete MFA verification.");
  }

  return (
    <main className="security-login-page">
      <section className="security-login-brand" aria-label="RizPoint security">
        <div className="security-login-brand__mark">R</div>
        <div>
          <span className="page-kicker">RizPoint secure workspace</span>
          <h1>Research evidence deserves a serious security boundary.</h1>
          <p>
            Individual access, mandatory authenticator verification, durable
            session controls, and encrypted Amazon credentials protect every
            sourcing decision.
          </p>
        </div>
        <ul className="security-login-trust">
          <li>
            <ShieldCheck aria-hidden="true" /> Mandatory MFA
          </li>
          <li>
            <LockKeyhole aria-hidden="true" /> Encrypted credentials
          </li>
          <li>
            <KeyRound aria-hidden="true" /> Individual accounts only
          </li>
        </ul>
      </section>

      <section className="security-login-panel">
        {step === "PASSWORD" ? (
          <form action={begin} className="security-login-form">
            <span className="page-kicker">Private access</span>
            <h2>Sign in to RizPoint</h2>
            <p>
              Use your individual account. Shared credentials are prohibited.
            </p>
            <label>
              Work email
              <input
                required
                name="email"
                type="email"
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                required
                minLength={14}
                name="password"
                type="password"
                autoComplete="current-password"
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Verifying…" : "Continue securely"}
            </button>
          </form>
        ) : null}

        {step === "MFA" ? (
          <form action={verifyMfa} className="security-login-form">
            <span className="page-kicker">Second factor</span>
            <h2>
              {usingRecoveryCode
                ? "Use a recovery code"
                : "Verify your identity"}
            </h2>
            <p>
              {usingRecoveryCode
                ? "Recovery codes work once and are invalidated immediately."
                : "Enter the six-digit code from your authenticator application."}
            </p>
            <label>
              {usingRecoveryCode ? "Recovery code" : "Authenticator code"}
              <input
                required
                name="factor"
                inputMode={usingRecoveryCode ? "text" : "numeric"}
                autoComplete="one-time-code"
                pattern={usingRecoveryCode ? undefined : "[0-9]{6}"}
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Verifying…" : "Sign in"}
            </button>
            <button
              className="security-text-button"
              type="button"
              onClick={() => {
                setUsingRecoveryCode((current) => !current);
                setError(null);
              }}
            >
              {usingRecoveryCode
                ? "Use authenticator instead"
                : "Use a recovery code"}
            </button>
          </form>
        ) : null}

        {step === "ENROLL" ? (
          <form
            action={confirmEnrollment}
            className="security-login-form security-enrollment"
          >
            <span className="page-kicker">Required enrollment</span>
            <h2>Protect your account with MFA</h2>
            <p>
              Scan this code with a standard TOTP authenticator, then confirm
              one code.
            </p>
            {qrDataUrl ? (
              <Image
                src={qrDataUrl}
                alt="RizPoint authenticator enrollment QR code"
                width={220}
                height={220}
                unoptimized
              />
            ) : null}
            <details>
              <summary>Cannot scan? Enter the key manually</summary>
              <code>{manualKey}</code>
            </details>
            <label>
              Six-digit authenticator code
              <input
                required
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Confirming…" : "Activate MFA"}
            </button>
          </form>
        ) : null}

        {step === "RECOVERY_CODES" ? (
          <div className="security-login-form">
            <span className="page-kicker">One-time display</span>
            <h2>Save your recovery codes now</h2>
            <p>
              Each code works once. RizPoint stores only hashes and cannot show
              these codes again.
            </p>
            <div className="security-recovery-grid">
              {recoveryCodes.map((code) => (
                <code key={code}>{code}</code>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setRecoveryCodes([]);
                setStep("PASSWORD");
                setError(
                  "MFA is active. Sign in with your new authenticator code.",
                );
              }}
            >
              <Check aria-hidden="true" /> I saved these codes
            </button>
          </div>
        ) : null}

        {step === "RESET" ? (
          <form action={resetPassword} className="security-login-form">
            <span className="page-kicker">Password lifecycle</span>
            <h2>Set a new password</h2>
            <p>
              Use 14+ characters with upper and lower case, a number, and a
              special character. Do not include identity information.
            </p>
            <label>
              New password
              <input
                required
                minLength={14}
                name="password"
                type="password"
                autoComplete="new-password"
              />
            </label>
            <label>
              Confirm new password
              <input
                required
                minLength={14}
                name="confirmation"
                type="password"
                autoComplete="new-password"
              />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        ) : null}

        {error ? (
          <p className="security-login-message" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          Credentials and MFA secrets are never stored in browser storage or
          logs.
        </footer>
      </section>
    </main>
  );
}
