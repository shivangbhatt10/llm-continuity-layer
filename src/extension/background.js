// Background Service Worker for LLM Continuity Extension

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Continuity Extension] Installed and registered background service worker.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "open_target_tab") {
    chrome.tabs.create({ url: message.url }, (tab) => {
      sendResponse({ success: true, tabId: tab.id });
    });
    return true; // Keep message channel open for async response
  }
});
