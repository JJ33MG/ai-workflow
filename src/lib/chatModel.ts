// Which model answers in the chat (Jarne, 27 Nov: cheaper, but advice must not get worse): the mid model for
// everyday questions; the top model for screenshots and files, long questions, or when Jarne asks to think hard.
const DEEP = /denk (goed|grondig|diep) na|grondig|diepgaand|think (hard|carefully|deeply)|in[- ]depth|deep dive|analyse grondig/i;

export function chatModelFor(question: string, hasFiles: boolean, models: { top: string; chat: string }): string {
  if (hasFiles || question.length > 500 || DEEP.test(question)) return models.top;
  return models.chat;
}
