export function listingDraftCanBeApproved(
  claimStatuses: readonly ("VERIFIED" | "UNVERIFIED")[],
): boolean {
  return !claimStatuses.includes("UNVERIFIED");
}
