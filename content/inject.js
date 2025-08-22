(function () {
  if (window.__pl_injected__) return;
  window.__pl_injected__ = true;

  // ========== DOM ==========
  const drawer = document.createElement("div");
  drawer.id = "pl-drawer";
  drawer.innerHTML = `
    <div id="pl-head">
      <div id="pl-title">PageLearner</div>
      <button id="pl-close">关闭</button>
    </div>
    <div id="pl-chat">
      <div id="pl-messages"></div>
      <div id="pl-inputbar">
        <textarea id="pl-text" placeholder="输入内容，回车发送；Shift+Enter 换行"></textarea>
        <button id="pl-send">发送</button>
      </div>
    </div>
  `;
  document.documentElement.appendChild(drawer);

  const $close = drawer.querySelector("#pl-close");
  const $messages = drawer.querySelector("#pl-messages");
  const $text = drawer.querySelector("#pl-text");
  const $send = drawer.querySelector("#pl-send");

  $close.addEventListener("click", () => drawer.classList.remove("pl-open"));

  // ========== Chat Helpers ==========
  const history = []; // [{role, content}]

  function addMsg(role, text, extraClass = "") {
    const div = document.createElement("div");
    div.className = `pl-msg ${role} ${extraClass}`.trim();

    // 支持换行（\n → <br>）
    // 支持粗体（**内容** → <b>内容</b>）
    let html = text
        .replace(/\n/g, "<br>")
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

    div.innerHTML = html; // ← 用 innerHTML 而不是 textContent
    $messages.appendChild(div);
    $messages.scrollTop = $messages.scrollHeight;
    return div;
  }


  function toggleDrawer() {
    drawer.classList.toggle("pl-open");
    if (drawer.classList.contains("pl-open")) setTimeout(() => $text.focus(), 50);
  }

  async function sendCurrent() {
    const t = ($text.value || "").trim();
    if (!t) return;
    $text.value = "";
    $text.style.height = "40px";

    addMsg("user", t);
    history.push({ role: "user", content: t });

    // typing
    const thinking = addMsg("assistant", "思考中…", "thinking");

    // 发消息到 background 调 Qwen
    chrome.runtime.sendMessage(
      { type: "QWEN_CHAT", text: t, history },
      (res) => {
        thinking.remove();

        if (!res?.ok) {
          addMsg("assistant", `调用失败：${res?.error || "未知错误"}`);
          return;
        }

        addMsg("assistant", res.reply);
        history.push({ role: "assistant", content: res.reply });
      }
    );
  }

  // 事件
  $send.addEventListener("click", sendCurrent);

  $text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCurrent();
    }
  });

  $text.addEventListener("input", () => {
    $text.style.height = "auto";
    const h = Math.min($text.scrollHeight, 120);
    $text.style.height = h + "px";
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "TOGGLE_DRAWER") {
      toggleDrawer();
      sendResponse?.({ ok: true });
      return true;
    }
  });
})();
