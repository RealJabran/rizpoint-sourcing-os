chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => undefined);
chrome.runtime.onMessage.addListener((message) => {
  if (message?.kind === "RIZPOINT_TARGET")
    chrome.storage.session.set({ target: message.target });
});
