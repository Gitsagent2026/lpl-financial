import { getDb } from "../../../lib/db.js";
import { answerCallback, editMessage, buildApprovedMessage, buildDeniedMessage, buildRedirectedMessage } from "../../../lib/telegram.js";

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req) {
  try {
    var body = await req.json();

    if (!body.callback_query) {
      return jsonResponse({ ok: true });
    }

    var callbackId = body.callback_query.id;
    var data = body.callback_query.data;
    var message = body.callback_query.message;
    if (!data || !message) {
      return jsonResponse({ ok: true });
    }

    var parts = data.split(":");
    var action = parts[0];
    var taskId = parts[1];
    if (!taskId || (action !== "approve" && action !== "deny" && action !== "redirect")) {
      return jsonResponse({ ok: true });
    }

    var chatId = message.chat.id;
    var status = action === "approve" ? "approved" : action === "redirect" ? "redirected" : "denied";

    var sql = getDb(process.env);
    var rows = await sql`
      UPDATE pending_logins
      SET status = ${status},
          resolved_at = ${Date.now()},
          resolved_by = 'telegram'
      WHERE id = ${taskId} AND status = 'pending'
      RETURNING *
    `;

    if (rows.length === 0) {
      var peerUrls = (process.env.PEER_WEBHOOK_URL || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      var handled = false;
      for (var i = 0; i < peerUrls.length; i++) {
        try {
          var peerRes = await fetch(peerUrls[i], {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (peerRes.ok) {
            var peerData = await peerRes.json();
            if (peerData.handled) {
              handled = true;
              break;
            }
          }
        } catch (e) {}
      }
      if (!handled) {
        await answerCallback(process.env, chatId, callbackId, "Already handled or not found");
      }
      return jsonResponse({ ok: true, handled: handled });
    }

    var task = rows[0];
    await answerCallback(process.env, chatId, callbackId, status.charAt(0).toUpperCase() + status.slice(1));

    var updatedText = status === "approved"
      ? buildApprovedMessage(task)
      : status === "redirected"
      ? buildRedirectedMessage(task)
      : buildDeniedMessage(task);
    await editMessage(process.env, chatId, message.message_id, updatedText);

    return jsonResponse({ ok: true, handled: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return jsonResponse({ error: "Webhook error" }, 500);
  }
}
