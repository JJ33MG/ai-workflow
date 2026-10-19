import { config } from "../config.js";

const MAX_LEN = 4000; // Telegram's limit is 4096; leave room

export const isTelegramConfigured = () => Boolean(config.telegram.botToken && config.telegram.chatId);

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${config.telegram.botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result;
}

/** Sends to Jarne's chat. Without a bot token it prints to stdout instead. */
export async function notify(text: string): Promise<void> {
  if (!isTelegramConfigured()) {
    console.log(`[telegram:not-configured]\n${text}`);
    return;
  }
  for (const chunk of splitMessage(text)) {
    await call("sendMessage", { chat_id: config.telegram.chatId, text: chunk });
  }
}

export function splitMessage(text: string, max = MAX_LEN): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

interface Update {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
}

export type CommandHandler = (command: string, args: string[]) => Promise<string>;

/**
 * Long-polls for commands. Only messages from TELEGRAM_CHAT_ID are handled,
 * so nobody else who finds the bot can approve spending.
 */
export function startCommandPolling(handler: CommandHandler): () => void {
  if (!isTelegramConfigured()) return () => {};
  let stopped = false;
  let offset = 0;

  const loop = async () => {
    while (!stopped) {
      try {
        const updates = await call<Update[]>("getUpdates", { offset, timeout: 30 });
        for (const u of updates) {
          offset = u.update_id + 1;
          const msg = u.message;
          if (!msg?.text || String(msg.chat.id) !== config.telegram.chatId) continue;
          const [command, ...args] = msg.text.trim().split(/\s+/);
          if (!command.startsWith("/")) continue;
          const reply = await handler(command.slice(1).split("@")[0].toLowerCase(), args).catch(
            (err: Error) => `Error: ${err.message}`,
          );
          await notify(reply);
        }
      } catch (err) {
        console.error("[telegram] polling error:", err);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
