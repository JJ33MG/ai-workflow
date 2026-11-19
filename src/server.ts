import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { collectBriefingData, formatBriefing } from "./agents/ceo.js";
import { agents, syncAgents } from "./agents/index.js";
import { handleCommand } from "./commands.js";
import { config } from "./config.js";
import { setPlanStatus } from "./brain.js";
import { ChatUnavailableError, chatHistory, sendChat } from "./chat.js";
import { buildBusinessDetail, buildDashboard } from "./dashboard.js";
import { db, getSetting } from "./db.js";
import * as etsy from "./integrations/etsy.js";
import * as ebay from "./integrations/ebay.js";
import * as meta from "./integrations/meta.js";
import * as pinterest from "./integrations/pinterest.js";
import { decide, decideAll } from "./lib/approvals.js";
import { loadCatalog } from "./lib/catalogSetup.js";
import { addCampaign } from "./lib/marketing.js";
import { businessById } from "./businesses.js";
import { loadEtsySetup } from "./lib/etsySetup.js";
import { agentLogger } from "./lib/logger.js";
import { loadPrintfulSetup } from "./lib/printfulSetup.js";
import { hasPrintfulToken } from "./integrations/printful.js";
import { designsDir } from "./lib/design.js";
import { enqueue, enqueueOnce, requeueInterrupted } from "./lib/tasks.js";
import { notify, startCommandPolling } from "./lib/telegram.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.use(express.json());

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const given = req.header("authorization")?.replace(/^Bearer /, "") ?? String(req.query.token ?? "");
  const expected = config.adminToken;
  const ok =
    expected.length > 0 &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

app.get("/health", async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ ok: true, dryRun: config.dryRun });
});

// Design files must be publicly reachable: Printful downloads them to print.
app.use("/files/designs", express.static(designsDir(), { index: false }));

// The dashboard page itself holds no data; it asks for the admin token and calls /api/dashboard.
const dashboardDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "dashboard");
app.get("/", (_req, res) => res.redirect("/dashboard/"));
app.use("/dashboard", express.static(dashboardDir));

app.get("/api/dashboard", requireAdmin, async (_req, res) => {
  res.json(await buildDashboard());
});

app.get("/api/businesses/:id", requireAdmin, async (req, res) => {
  const detail = await buildBusinessDetail(String(req.params.id));
  if (!detail) {
    res.status(404).json({ error: "No such business" });
    return;
  }
  res.json(detail);
});

// Chat with an agent. A reply can take up to a minute when the agent uses tools.
app.get("/api/agents/:id/chat", requireAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  if (!agents.has(id)) {
    res.status(404).json({ error: "No such agent" });
    return;
  }
  res.json(await chatHistory(id));
});

app.post("/api/agents/:id/chat", requireAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const text = String((req.body as { message?: string }).message ?? "").trim();
  const voice = (req.body as { voice?: boolean }).voice === true;
  if (!agents.has(id)) {
    res.status(404).json({ error: "No such agent" });
    return;
  }
  if (!text) {
    res.status(400).json({ error: "Type a message first" });
    return;
  }
  try {
    res.json(await sendChat(id, text, { voice }));
  } catch (err) {
    if (err instanceof ChatUnavailableError) {
      res.status(503).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// Jarne ticks off his own steps in the build plan.
app.post("/api/plan/:id", requireAdmin, async (req, res) => {
  const status = String((req.body as { status?: string }).status ?? "");
  if (!["done", "doing", "todo"].includes(status)) {
    res.status(400).json({ error: "status moet done, doing of todo zijn" });
    return;
  }
  try {
    const item = await setPlanStatus(String(req.params.id), status as "done" | "doing" | "todo");
    res.json({ message: status === "done" ? `Afgevinkt: ${item.title}` : `Bijgewerkt: ${item.title}`, item });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// A seasonal campaign started by hand (the marketing agent starts its own through plays).
app.post("/api/marketing/campaigns", requireAdmin, async (req, res) => {
  const b = req.body as { businessId?: string; name?: string; direction?: string; from?: string; until?: string };
  if (!b.businessId || !businessById(b.businessId) || !b.name || !b.direction || !b.from || !b.until) {
    res.status(400).json({ error: "businessId, name, direction, from en until zijn verplicht" });
    return;
  }
  try {
    const c = await addCampaign({ businessId: b.businessId, name: b.name.slice(0, 80), direction: b.direction.slice(0, 1500), from: b.from, until: b.until });
    await agentLogger("marketing").info(`Campagne gestart: ${c.name} (${c.from} t/m ${c.until})`, c);
    res.json({ message: `Campagne gestart: ${c.name}`, campaign: c });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// The latest pricing report (etsy-pod:pricing_report): real profit per product and market.
app.get("/api/pricing", requireAdmin, async (_req, res) => {
  res.json((await getSetting("pricing.report")) ?? { rows: [], problems: ["Nog geen prijscheck gedaan: start etsy-pod:pricing_report"] });
});

// Reviewing listings one by one (Etsy requires individual human oversight): publish or reject a draft.
app.post("/api/listings/:id/:action", requireAdmin, async (req, res) => {
  const { id, action } = req.params as { id: string; action: string };
  const listing = await db.listing.findUnique({ where: { id } });
  if (!listing || !["publish", "reject"].includes(action) || listing.status !== "uploaded") {
    res.status(400).json({ error: "Deze listing kan niet (meer) gepubliceerd of afgekeurd worden" });
    return;
  }
  if (action === "reject") {
    await db.listing.update({ where: { id }, data: { status: "rejected" } });
    res.json({ message: `Afgekeurd: ${listing.title}. Het concept blijft onzichtbaar op Etsy; verwijder het daar als je wilt.` });
    return;
  }
  await enqueue("etsy-pod", "publish_listings", { listingIds: [id] });
  res.json({ message: `Wordt gepubliceerd: ${listing.title}` });
});

// Jarne's marketing to-dos: "done" starts the clock (judged at a later review), "skip" drops it.
app.post("/api/marketing/plays/:id", requireAdmin, async (req, res) => {
  const action = String((req.body as { action?: string }).action ?? "");
  const play = await db.marketingPlay.findUnique({ where: { id: String(req.params.id) } });
  if (!play || play.status !== "todo" || !["done", "skip"].includes(action)) {
    res.status(400).json({ error: "Deze actie kan niet (meer) worden aangepast" });
    return;
  }
  await db.marketingPlay.update({
    where: { id: play.id },
    data: action === "done" ? { status: "running", startedAt: new Date() } : { status: "skipped", note: "Overgeslagen door Jarne" },
  });
  res.json({ message: action === "done" ? `Gedaan: ${play.title}. Wordt bij een volgende review beoordeeld.` : `Overgeslagen: ${play.title}` });
});

// Failed task actions. Retry starts it fresh; dismiss hides it from problems.
app.post("/api/tasks/:id/:action", requireAdmin, async (req, res) => {
  const { id, action } = req.params as { id: string; action: string };
  const task = await db.task.findUnique({ where: { id } });
  if (!task) {
    res.status(404).json({ error: "No such task" });
    return;
  }
  if (!["failed", "escalated", "pending"].includes(task.status)) {
    res.status(409).json({ error: `Task is ${task.status}` });
    return;
  }
  if (action === "retry") {
    await db.task.update({
      where: { id },
      data: { status: "pending", attempts: 0, runAfter: new Date(), finishedAt: null },
    });
    res.json({ message: `Queued ${task.agentId}:${task.type} to run again` });
  } else if (action === "dismiss") {
    await db.task.update({ where: { id }, data: { status: "dismissed", finishedAt: new Date() } });
    res.json({ message: "Dismissed" });
  } else {
    res.status(400).json({ error: "action must be retry or dismiss" });
  }
});

app.post(["/api/agents/:id/pause", "/api/agents/:id/resume"], requireAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const action = req.path.endsWith("/resume") ? "resume" : "pause";
  if (!agents.has(id)) {
    res.status(404).json({ error: "No such agent" });
    return;
  }
  await db.agent.update({ where: { id }, data: { enabled: action === "resume" } });
  res.json({ message: `${id} ${action === "resume" ? "resumed" : "paused"}` });
});

app.get("/api/status", requireAdmin, async (_req, res) => {
  res.json(await collectBriefingData());
});

app.get("/api/briefing/preview", requireAdmin, async (_req, res) => {
  res.type("text/plain").send(formatBriefing(await collectBriefingData()));
});

app.get("/api/approvals", requireAdmin, async (_req, res) => {
  res.json(await db.approval.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } }));
});

// All pending "publish listings" decisions at once.
app.post("/api/approvals-all/etsy_publish", requireAdmin, async (_req, res) => {
  res.json({ message: await decideAll("etsy_publish") });
});

app.post("/api/approvals/:id/:decision", requireAdmin, async (req, res) => {
  const { id, decision } = req.params as { id: string; decision: string };
  if (decision !== "approve" && decision !== "reject") {
    res.status(400).json({ error: "decision must be approve or reject" });
    return;
  }
  res.json({ message: await decide(id, decision === "approve") });
});

app.post("/api/agents/:id/tasks", requireAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const { type, payload } = req.body as { type?: string; payload?: Record<string, unknown> };
  if (!type || !agents.get(id)?.handlers[type]) {
    res.status(400).json({ error: `Unknown task ${id}:${type}` });
    return;
  }
  const task = await enqueue(id, type, payload ?? {});
  res.status(201).json({ message: `Queued ${id}:${type}; it starts within 15 seconds`, task });
});

app.get("/api/logs", requireAdmin, async (req, res) => {
  res.json(
    await db.log.findMany({
      where: req.query.agent ? { agentId: String(req.query.agent) } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );
});

// Etsy OAuth: open /auth/etsy/start?token=ADMIN_TOKEN in a browser once.
app.get("/auth/etsy/start", requireAdmin, async (_req, res) => {
  res.redirect(await etsy.buildAuthUrl());
});

app.get("/auth/etsy/callback", async (req, res) => {
  try {
    await etsy.handleCallback(String(req.query.code ?? ""), String(req.query.state ?? ""));
    // Look up the shop's settings and pull the shop in right away instead of waiting for the hourly sync.
    await enqueue("etsy-pod", "etsy_setup");
    await enqueue("etsy-pod", "sync_listings");
    await enqueue("etsy-pod", "sync_sales");
    res.send("Etsy connected. You can close this tab.");
  } catch (err) {
    res.status(400).send(`Etsy connection failed: ${(err as Error).message}`);
  }
});

// Railway calls this when a deploy fails or the server crashes, so Jarne hears it in Telegram.
// The secret in the path (RAILWAY_HOOK_SECRET) keeps strangers from sending fake alerts.
app.post("/hooks/railway/:secret", async (req, res) => {
  const secret = process.env.RAILWAY_HOOK_SECRET ?? "";
  const given = String(req.params.secret);
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    res.status(404).end();
    return;
  }
  const body = req.body as { type?: string; resource?: { service?: { name?: string } }; details?: { status?: string } };
  const what = String(body.type ?? "event").replace("Deployment.", "deploy ");
  await notify(
    `🚨 Railway: ${what}${body.resource?.service?.name ? ` (${body.resource.service.name})` : ""}. ` +
      "Ik (Claude) kan de logs bekijken en het oplossen: zeg het me in de chat.",
  );
  res.json({ ok: true });
});

// Public privacy policy: Pinterest and Meta ask for one when you create a developer app.
// Also under /privacy/<brand>: Pinterest wants the company name in the URL.
app.get(["/privacy", "/privacy/:brand"], (_req, res) => {
  res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy policy · All You Can Wish</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#222}</style></head><body>
<h1>Privacy policy</h1>
<p>This app is the private marketing and shop tool of All You Can Wish (AllyouwishDesigns, <a href="https://www.etsy.com/shop/AllyouwishDesigns">our Etsy shop</a>). It is used only by the shop owner.</p>
<h2>What it does</h2>
<p>With the owner's permission it publishes posts about our own products to the owner's own Pinterest, Facebook and Instagram accounts, lists our own products in the owner's own Etsy and eBay shops, and reads those shops' data (listings, orders) to run them.</p>
<h2>Data</h2>
<p>We store only the access tokens the owner grants and the IDs of the posts we create. We do not collect, sell or share personal data of other users. Order details from Etsy are used only to fulfil those orders.</p>
<h2>Removing access</h2>
<p>The owner can revoke access at any time in the settings of Pinterest, Facebook, Instagram or Etsy. To have any stored data deleted, contact us through our Etsy shop.</p>
</body></html>`);
});

// Pinterest OAuth: open /auth/pinterest/start?token=ADMIN_TOKEN in a browser once.
app.get("/auth/pinterest/start", requireAdmin, async (_req, res) => {
  res.redirect(await pinterest.buildAuthUrl());
});

app.get("/auth/pinterest/callback", async (req, res) => {
  try {
    const user = await pinterest.handleCallback(String(req.query.code ?? ""), String(req.query.state ?? ""));
    await agentLogger("marketing").info(`Pinterest gekoppeld: ${user}`);
    // Asks Jarne's go-ahead first (new platform), then pins daily.
    await enqueue("marketing", "pinterest_pins");
    res.send(`Pinterest connected (${user}). You can close this tab.`);
  } catch (err) {
    res.status(400).send(`Pinterest connection failed: ${(err as Error).message}`);
  }
});

// eBay OAuth: open /auth/ebay/start?token=ADMIN_TOKEN in a browser once.
app.get("/auth/ebay/start", requireAdmin, async (_req, res) => {
  res.redirect(await ebay.buildAuthUrl());
});

app.get("/auth/ebay/callback", async (req, res) => {
  try {
    await ebay.handleCallback(String(req.query.code ?? ""), String(req.query.state ?? ""));
    await agentLogger("ebay").info("eBay gekoppeld");
    await enqueue("ebay", "ebay_setup");
    res.send("eBay connected. You can close this tab.");
  } catch (err) {
    res.status(400).send(`eBay connection failed: ${(err as Error).message}`);
  }
});

// What to enter in eBay's developer portal (Alerts & Notifications → Marketplace account deletion).
app.get("/auth/ebay/info", requireAdmin, (_req, res) => {
  res.json({
    deletionEndpoint: ebay.deletionEndpoint(),
    verificationToken: ebay.verificationToken(),
    acceptUrl: `${config.publicUrl}/auth/ebay/callback`,
    privacyPolicyUrl: `${config.publicUrl}/privacy/AllyouwishDesigns`,
  });
});

// eBay's marketplace account deletion notifications (required for every production app). We keep no
// eBay user data beyond orders, so a notification only needs acknowledging.
app.get("/hooks/ebay/deletion", (req, res) => {
  const code = String(req.query.challenge_code ?? "");
  if (!code) {
    res.status(400).json({ error: "challenge_code missing" });
    return;
  }
  res.type("application/json").json({ challengeResponse: ebay.challengeResponse(code) });
});
app.post("/hooks/ebay/deletion", (_req, res) => {
  res.status(200).end();
});

// Instagram + Facebook (one Meta app): open /auth/meta/start?token=ADMIN_TOKEN in a browser once.
app.get("/auth/meta/start", requireAdmin, async (_req, res) => {
  res.redirect(await meta.buildAuthUrl());
});

app.get("/auth/meta/callback", async (req, res) => {
  try {
    const c = await meta.handleCallback(String(req.query.code ?? ""), String(req.query.state ?? ""));
    const what = c.instagramUsername ? `Facebook-pagina ${c.pageName} en Instagram ${c.instagramUsername}` : `Facebook-pagina ${c.pageName} (geen Instagram gekoppeld)`;
    await agentLogger("marketing").info(`Meta gekoppeld: ${what}`);
    await enqueue("marketing", "meta_posts");
    res.send(`Connected: ${what}. You can close this tab.`);
  } catch (err) {
    res.status(400).send(`Instagram/Facebook connection failed: ${(err as Error).message}`);
  }
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[http]", err);
  res.status(500).json({ error: err.message });
});

async function main() {
  if (!config.adminToken) console.warn("ADMIN_TOKEN is not set: the /api routes will refuse every request.");
  await syncAgents();
  const requeued = await requeueInterrupted();
  if (requeued) console.log(`Requeued ${requeued} task(s) cut off by the last restart`);
  // Printful product and print size: loaded if found before, otherwise looked up in the background.
  if (!(await loadPrintfulSetup()) && hasPrintfulToken()) await enqueueOnce("etsy-pod", "printful_setup");
  if (!(await loadEtsySetup()) && (await etsy.isEtsyConnected())) await enqueueOnce("etsy-pod", "etsy_setup");
  // Product range (mugs, shirts, totes …): loaded if found before, otherwise looked up once both shops are known.
  if (!(await loadCatalog()) && hasPrintfulToken() && (await etsy.isEtsyConnected())) await enqueueOnce("etsy-pod", "catalog_setup");
  const stopScheduler = startScheduler();
  const stopPolling = startCommandPolling(handleCommand);
  const server = app.listen(config.port, () => {
    console.log(`AI Agency Brain listening on :${config.port} (dryRun=${config.dryRun})`);
  });

  // Clean exit on a deploy or restart: stop taking work, close connections, exit 0. Open
  // keep-alive connections would hold server.close() open, so they are closed too, and a
  // fallback exits after 8 s (Railway kills the container after 10 s, which reads as a crash).
  const shutdown = () => {
    console.log("Shutting down");
    stopScheduler();
    stopPolling();
    setTimeout(() => process.exit(0), 8000).unref();
    server.close(() => void db.$disconnect().finally(() => process.exit(0)));
    server.closeAllConnections();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
