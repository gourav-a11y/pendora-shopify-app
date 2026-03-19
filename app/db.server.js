import { PrismaClient } from "@prisma/client";

function makePrisma() {
  const client = new PrismaClient();
  // Enable WAL mode so concurrent reads/writes don't block each other.
  // WAL is a database-level setting that persists in the .sqlite file —
  // setting it once is enough, repeated calls are harmless no-ops.
  client.$executeRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => {});
  return client;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = makePrisma();
  }
}

const prisma = global.prismaGlobal ?? makePrisma();

export default prisma;
