import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient();

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
}
