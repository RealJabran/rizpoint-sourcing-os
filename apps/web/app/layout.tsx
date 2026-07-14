import type { Metadata } from "next";
import "./styles.css";
import { assertProductionConfiguration } from "@/src/runtime-config";

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
      <body>{children}</body>
    </html>
  );
}
