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

export type Button = { text: string; callback_data: string };

/** Approve and reject under every approval; publications also get "approve all" (money decisions never do). */
export function approvalButtons(id: string, kind: string): Button[][] {
  const rows: Button[][] = [[{ text: "✅ Goedkeuren", callback_data: `approve:${id}` }, { text: "❌ Afwijzen", callback_data: `reject:${id}` }]];
  if (kind === "etsy_publish") rows.push([{ text: "✅ Alles goedkeuren (alle publicaties)", callback_data: "approve:alles" }]);
  return rows;
}

/** A tapped button back into a command; only approve and reject are buttons. */
export function parseButton(data: string | undefined): { command: "approve" | "reject"; args: string[] } | null {
  const m = /^(approve|reject):([A-Za-z0-9_-]{1,64})$/.exec(data ?? "");
  return m ? { command: m[1] as "approve" | "reject", args: [m[2]] } : null;
}

/** Sends to Jarne's chat, optionally with buttons under the (last) message. Without a bot token it prints to stdout. */
export async function notify(text: string, buttons?: Button[][]): Promise<void> {
  if (!isTelegramConfigured()) {
    console.log(`[telegram:not-configured]\n${text}`);
    return;
  }
  const chunks = splitMessage(text);
  for (const [i, chunk] of chunks.entries()) {
    const markup = buttons && i === chunks.length - 1 ? { reply_markup: { inline_keyboard: buttons } } : {};
    await call("sendMessage", { chat_id: config.telegram.chatId, text: chunk, ...markup });
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
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
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
        const updates = await call<Update[]>("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
        for (const u of updates) {
          offset = u.update_id + 1;
          const cb = u.callback_query;
          if (cb) {
            // A tapped button: only from Jarne's own chat, like typed commands.
            const parsed = parseButton(cb.data);
            const fromJarne = cb.message && String(cb.message.chat.id) === config.telegram.chatId;
            await call("answerCallbackQuery", { callback_query_id: cb.id, text: parsed && fromJarne ? "Bezig…" : "Niet toegestaan" }).catch(() => {});
            if (!parsed || !fromJarne) continue;
            const reply = await handler(parsed.command, parsed.args).catch((err: Error) => `Error: ${err.message}`);
            // The buttons are used: take them away so a second tap cannot happen.
            await call("editMessageReplyMarkup", { chat_id: config.telegram.chatId, message_id: cb.message!.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
            await notify(reply);
            continue;
          }
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
