import { targetFromUrl } from "./target.js";
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => undefined);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.kind === "RIZPOINT_TARGET")
    chrome.storage.session.set({ target: message.target });
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.startsWith("https://"))
    chrome.storage.session.set({ target: targetFromUrl(tab.url) });
});
