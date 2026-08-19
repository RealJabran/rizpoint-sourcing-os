// URL context only. Product HTML is intentionally never read or transmitted.
import { targetFromUrl } from "./target.js";
chrome.runtime
  .sendMessage({
    kind: "RIZPOINT_TARGET",
    target: targetFromUrl(location.href),
  })
  .catch(() => undefined);
