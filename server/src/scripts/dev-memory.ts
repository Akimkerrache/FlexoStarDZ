/**
 * Development convenience: runs the API against a throwaway in-memory MongoDB and creates a temporary admin
 * with a random password printed to the console. Never use in production (data disappears on exit).
 */
import crypto from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main() {
  const mongod = await MongoMemoryServer.create();
  const rand = () => crypto.randomBytes(32).toString('base64url');
  process.env.MONGODB_URI = mongod.getUri('flexostar_dev');
  process.env.JWT_ACCESS_SECRET ||= rand();
  process.env.JWT_REFRESH_SECRET ||= rand();
  process.env.LOG_LEVEL ||= 'info';
  const password = `${rand().slice(0, 16)}Aa1!`;
  Object.assign(process.env, { INITIAL_ADMIN_NAME: 'Dev Admin', INITIAL_ADMIN_EMAIL: 'admin@flexostar.local', INITIAL_ADMIN_PASSWORD: password });

  const { connectDb } = await import('./../database/index.js');
  const { createApp } = await import('./../app.js');
  const { env } = await import('./../config/env.js');
  const { User } = await import('./../modules/users/user.model.js');
  const { hashPassword } = await import('./../modules/auth/auth.service.js');
  const { ProductCategory, DEFAULT_CATEGORIES } = await import('./../modules/catalog/catalog.routes.js');

  await connectDb();
  for (const c of DEFAULT_CATEGORIES) await ProductCategory.updateOne({ code: c.code }, { $setOnInsert: c }, { upsert: true });
  await User.create({ name: 'Dev Admin', email: 'admin@flexostar.local', passwordHash: await hashPassword(password), role: 'admin' });
  createApp().listen(env.PORT, () => {
    console.log(`\nAPI on http://localhost:${env.PORT}${env.API_PREFIX}  (docs: /docs)`);
    console.log(`Temporary admin: admin@flexostar.local / ${password}\n`);
  });
  process.on('SIGINT', async () => { await mongod.stop(); process.exit(0); });

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
