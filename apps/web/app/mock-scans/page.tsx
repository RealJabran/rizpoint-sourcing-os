import { redirect } from "next/navigation";

/** Legacy diagnostic URL retained for bookmarks; the product surface is scans. */
export default function MockScansPage() {
  redirect("/scans");
}
