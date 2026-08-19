import type { targetFromUrl } from "./target.js";
type Target = ReturnType<typeof targetFromUrl>;
const $ = (id: string) =>
  document.getElementById(id) as
    HTMLInputElement | HTMLButtonElement | HTMLElement;
async function settings() {
  return chrome.storage.local.get(["baseUrl", "token", "projectId"]);
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
    const response = await fetch(
      `${String(saved.baseUrl).replace(/\/$/, "")}/api/research-companion`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${saved.token}`,
        },
        body: JSON.stringify({ ...target, action, projectId: saved.projectId }),
      },
    );
    const json = await response.json();
    $("result").textContent = response.ok
      ? JSON.stringify(json, null, 2)
      : `Error: ${json.error ?? response.status}`;
  } catch {
    $("result").textContent =
      "Offline or backend unavailable. No Amazon page data was collected.";
  }
}
for (const id of ["baseUrl", "token", "projectId"]) {
  const input = $(id) as HTMLInputElement;
  chrome.storage.local.get(id).then((v) => (input.value = String(v[id] ?? "")));
  input.addEventListener("change", () =>
    chrome.storage.local.set({ [id]: input.value.trim() }),
  );
}
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
