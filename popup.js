document.getElementById("open").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    const url = tab.url || "";
    if (!/^https?:\/\//i.test(url)) {
      alert("当前页面不支持注入（如 chrome://）。请在普通网页使用。");
      window.close();
      return;
    }

    // 先尝试直接触发抽屉
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_DRAWER" });
  } catch {
    // 若 content script 尚未注入，则动态注入一次再重试
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content/inject.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/inject.js"] });
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_DRAWER" });
    } catch (err2) {
      console.error("[PageLearner] 注入/重试失败：", err2);
      alert("无法注入脚本，请检查 manifest 或刷新页面后再试。");
    }
  } finally {
    window.close();
  }
});
