// ========== DashScope 配置 ==========
const QWEN_API_KEY    = "PLEASE INSERT YOUR OWN KEYS"; // ← 换成你的 Key
const QWEN_ENDPOINT   = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const QWEN_MODEL_CHAT = "qwen-plus";     // 文本对话
const QWEN_MODEL_CLS  = "qwen-plus";     // 意图分类
const QWEN_MODEL_VL   = "qwen-vl-plus";  // 视觉多模态

// ========== 固定文案 ==========
const INTRO_MESSAGE = `
👋 你好呀！我是 **PageLearner** 🤖
如果你对当前页面的内容有困惑，请随时向我提问！
我会自动 🖼️ 截取屏幕并帮你理解。
让我们一起加油吧 🚀✨

（当前对话由通义千问 API 支持，请注意 token 消耗哦 💡）
`;

// ========== 基础请求封装 ==========
async function chatOnce({ model, messages, temperature = 0.7 }) {
  const resp = await fetch(QWEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + QWEN_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, messages, temperature })
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`DashScope HTTP ${resp.status} ${text}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

// ========== 意图识别（intro / screen / other） ==========
async function classifyIntent(userText) {
  const system = [
    "你是意图分类器，仅输出JSON：{\"intent\":\"intro|screen|other\"}",
    "规则：",
    "intro：问候/你是谁/怎么用；",
    "screen：包含“这个页面/当前页面/看看这个/截图/看下图/图里”等，需要结合屏幕；",
    "other：其余普通对话。"
  ].join("\n");

  const out = await chatOnce({
    model: QWEN_MODEL_CLS,
    temperature: 0.1,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText }
    ]
  });

  try {
    const m = out.match(/\{[\s\S]*\}/);
    const json = JSON.parse(m ? m[0] : out);
    const raw = String(json.intent || "").toLowerCase();
    if (raw === "intro" || raw === "screen" || raw === "other") return raw;
  } catch (_) {}
  // 兜底关键词
  const t = userText.toLowerCase();
  if (/(这个页面|当前页面|看看这个|看下这个|截图|这张图|图里)/.test(userText)) return "screen";
  if (/(你好|你是谁|怎么用|自我介绍)/.test(userText)) return "intro";
  return "other";
}

// ========== 文本对话 ==========
async function chatNormal({ history = [], userText, system = "You are PageLearner assistant." }) {
  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userText }
  ];
  return await chatOnce({ model: QWEN_MODEL_CHAT, messages, temperature: 0.7 });
}

// ========== 截屏 + 视觉理解 ==========
async function captureVisibleTabDataURL(windowId) {
  // 可视区域截图（不是整页）。需要 "tabs"/"activeTab" 权限（manifest 里已有）。
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
    quality: 100
  });
  return dataUrl; // data:image/png;base64,....
}

function dataUrlToBase64(dataUrl) {
  return (dataUrl || "").replace(/^data:image\/[^;]+;base64,/, "");
}

async function chatVision({ userText, base64Image, system = "You are a vision assistant analyzing webpage screenshots." }) {
  // OpenAI 兼容格式：一条消息里放图片和文本
  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } },
        { type: "text", text: userText }
      ]
    }
  ];
  return await chatOnce({ model: QWEN_MODEL_VL, messages, temperature: 0.2 });
}

// ========== 消息路由 ==========
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "QWEN_CHAT") {
        const userText = (msg.text || "").slice(0, 8000);
        const history  = Array.isArray(msg.history) ? msg.history : [];
        const system   = msg.system || "You are PageLearner assistant.";

        // 1) 先识别意图
        const intent = await classifyIntent(userText);

        if (intent === "intro") {
          sendResponse({ ok: true, intent, reply: INTRO_MESSAGE });
          return;
        }

        if (intent === "screen") {
          // 2) 自动截屏（当前tab所在窗口）
          const windowId = sender?.tab?.windowId;
          if (!windowId) {
            sendResponse({ ok: false, intent, error: "无法获取windowId，无法截屏。" });
            return;
          }

          const dataUrl = await captureVisibleTabDataURL(windowId);
          const base64  = dataUrlToBase64(dataUrl);

          // 3) 送入通义千问多模态
          // 追加最近几轮文本上下文（可选，这里只把用户这轮发给视觉模型）
          const reply = await chatVision({ userText, base64Image: base64 });
          sendResponse({ ok: true, intent, reply });
          return;
        }

        // 其余走文本对话
        const reply = await chatNormal({ history, userText, system });
        sendResponse({ ok: true, intent, reply });
        return;
      }
    } catch (err) {
      console.error("[PageLearner] 后台处理失败：", err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // 异步
});

// 可选：安装日志
chrome.runtime.onInstalled.addListener(() => {
  console.log("[PageLearner] installed with screen recognition");
});
