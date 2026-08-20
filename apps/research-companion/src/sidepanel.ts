import type { targetFromUrl } from "./target.js";
import { normalizeBackendUrl } from "./backend-url.js";
type Target = ReturnType<typeof targetFromUrl>;
const $ = (id: string) =>
  document.getElementById(id) as
    HTMLInputElement | HTMLButtonElement | HTMLElement;
async function settings() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(["baseUrl", "projectId"]),
    chrome.storage.session.get(["token"]),
  ]);
  return { ...local, ...session };
}
async function run(action: string) {
  const { target } = (await chrome.storage.session.get("target")) as {
    target?: Target;
  };
  const saved = await settings();
  if (!target?.asin) {
    $("result").textContent =
      "No ASIN could be safely extracted from this URL. You may still open RizPoint and add it manually.";
    return;
  }
  if (!saved.baseUrl || !saved.token) {
    $("result").textContent =
      "Enter your RizPoint URL and a short-lived companion session token first.";
    return;
  }
  $("result").textContent = "Requesting authorized backend enrichment…";
  try {
    const baseUrl = normalizeBackendUrl(String(saved.baseUrl));
    if (!baseUrl) {
      $("result").textContent =
        "Use an HTTPS RizPoint origin (HTTP is allowed only for loopback development).";
      return;
    }
    const response = await fetch(`${baseUrl}/api/research-companion`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${saved.token}`,
      },
      body: JSON.stringify({ ...target, action, projectId: saved.projectId }),
    });
    const json = await response.json();
    $("result").textContent = response.ok
      ? JSON.stringify(json, null, 2)
      : `Error: ${json.error ?? response.status}`;
  } catch {
    $("result").textContent =
      "Offline or backend unavailable. No Amazon page data was collected.";
  }
}
for (const id of ["baseUrl", "projectId"]) {
  const input = $(id) as HTMLInputElement;
  chrome.storage.local.get(id).then((v) => (input.value = String(v[id] ?? "")));
  input.addEventListener("change", () =>
    chrome.storage.local.set({
      [id]:
        id === "baseUrl"
          ? (normalizeBackendUrl(input.value) ?? "")
          : input.value.trim(),
    }),
  );
}
const tokenInput = $("token") as HTMLInputElement;
chrome.storage.session
  .get("token")
  .then((value) => (tokenInput.value = String(value.token ?? "")));
tokenInput.addEventListener("change", () =>
  chrome.storage.session.set({ token: tokenInput.value.trim() }),
);
chrome.storage.session
  .get("target")
  .then(
    ({ target }) =>
      ($("target").textContent = target?.asin
        ? `ASIN ${target.asin} · ${target.host}`
        : "No supported Amazon product URL detected."),
  );
$("analyze").addEventListener("click", () => run("analyze"));
$("save").addEventListener("click", () => run("save"));
$("watch").addEventListener("click", () => run("watch"));
