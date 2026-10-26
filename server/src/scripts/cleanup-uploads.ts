import { connectDb, disconnectDb } from "../database/index.js";
import { cleanupAbandoned } from "../modules/files/file.service.js";

async function main() {
  await connectDb();
  console.log(`Aborted ${await cleanupAbandoned()} abandoned upload(s).`);
  await disconnectDb();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
