// Supabase Edge Function: send-push
// Sends a real push to every device a user has turned notifications on for.
//  1) Called by the database trigger when a notification row is inserted.
//     It only receives the row's id and re-reads the row itself, so nothing
//     in the request body is trusted, and it ignores rows older than 5 min.
//  2) Called by the "Test" button in the app (signed-in user, {"test": true}).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sendToUser(userId: string, payload: Record<string, string>) {
  const { data: subs, error } = await sb
    .from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", String(userId));
  if (error) throw error;
  const body = JSON.stringify(payload);
  let sent = 0, removed = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body, { TTL: 60 * 60 * 24, urgency: "high" },
      );
      sent++;
    } catch (e) {
      // 404/410 = that device uninstalled or revoked permission; clean it up.
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        removed++;
      } else {
        console.error("push failed", code, (e as Error).message);
      }
    }
  }));
  return { devices: subs?.length ?? 0, sent, removed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const input = await req.json().catch(() => ({}));

  // "Send test" from the app: a signed-in user pushes to their own devices.
  if (input?.test) {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return json({ error: "unauthorized" }, 401);
    return json(await sendToUser(user.id, {
      title: "Notifications are working",
      body: "You'll get booking alerts here, even when Sakkhi is closed.",
      url: "", tag: "sakkhi-test",
    }));
  }

  // Database trigger: look the notification up ourselves.
  const id = input?.record?.id;
  if (id === undefined || id === null) return json({ skipped: "no id" });
  const { data: rec } = await sb.from("notifications").select("*").eq("id", id).maybeSingle();
  if (!rec?.user_id) return json({ skipped: "not found" });
  const ageMs = Date.now() - new Date(rec.created_at ?? Date.now()).getTime();
  if (ageMs > 5 * 60 * 1000) return json({ skipped: "too old" });

  return json(await sendToUser(rec.user_id, {
    title: rec.title || "Sakkhi",
    body: rec.message || "",
    url: rec.action_url || "",
    tag: String(rec.action_url || rec.id || ""),
  }));
});
