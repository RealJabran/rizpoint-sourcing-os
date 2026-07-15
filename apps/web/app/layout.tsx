import type { Metadata } from "next";
import "./styles.css";
import { assertProductionConfiguration } from "@/src/runtime-config";
import { AppShell } from "@/src/components/app-shell";

export const metadata: Metadata = {
  title: "RizPoint Sourcing OS",
  description: "Explainable Amazon wholesale sourcing.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  assertProductionConfiguration();
  return (
    <html lang="en">
      {/* Some password/security extensions add attributes to body before React
          hydrates. Limit suppression to this element so real child mismatches
          still surface during development. */}
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
