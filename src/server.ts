import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { collectBriefingData, formatBriefing } from "./agents/ceo.js";
import { agents, syncAgents } from "./agents/index.js";
import { handleCommand } from "./commands.js";
import { config } from "./config.js";
import { buildDashboard } from "./dashboard.js";
import { db } from "./db.js";
import * as etsy from "./integrations/etsy.js";
import { decide } from "./lib/approvals.js";
import { designsDir } from "./lib/design.js";
import { enqueue } from "./lib/tasks.js";
import { startCommandPolling } from "./lib/telegram.js";
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
    res.send("Etsy connected. You can close this tab.");
  } catch (err) {
    res.status(400).send(`Etsy connection failed: ${(err as Error).message}`);
  }
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[http]", err);
  res.status(500).json({ error: err.message });
});

async function main() {
  if (!config.adminToken) console.warn("ADMIN_TOKEN is not set: the /api routes will refuse every request.");
  await syncAgents();
  const stopScheduler = startScheduler();
  const stopPolling = startCommandPolling(handleCommand);
  const server = app.listen(config.port, () => {
    console.log(`AI Agency Brain listening on :${config.port} (dryRun=${config.dryRun})`);
  });

  const shutdown = () => {
    stopScheduler();
    stopPolling();
    server.close(() => void db.$disconnect().then(() => process.exit(0)));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
