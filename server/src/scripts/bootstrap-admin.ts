import { connectDb, disconnectDb } from "../database/index.js";
import { env } from "../config/env.js";
import { User } from "../modules/users/user.model.js";
import { hashPassword } from "../modules/auth/auth.service.js";
import {
  emailSchema,
  passwordSchema,
} from "../modules/users/account.service.js";
import {
  ProductCategory,
  DEFAULT_CATEGORIES,
} from "../modules/catalog/catalog.routes.js";

/**
 * One-time bootstrap. Creates the first Admin from INITIAL_ADMIN_* (only when no admin exists) and seeds the
 * product categories listed in the specification. The password is never logged. Remove INITIAL_ADMIN_PASSWORD
 * from the environment afterwards; the account is flagged so the password must be changed at first login.
 */
async function main() {
  await connectDb();
  for (const c of DEFAULT_CATEGORIES)
    await ProductCategory.updateOne(
      { code: c.code },
      { $setOnInsert: c },
      { upsert: true },
    );
  console.log(`Product categories ensured (${DEFAULT_CATEGORIES.length}).`);

  if (await User.exists({ role: "admin" })) {
    console.log(
      "An administrator already exists: nothing to do. Remove INITIAL_ADMIN_PASSWORD from the environment.",
    );
  } else {
    const email = emailSchema.safeParse(env.INITIAL_ADMIN_EMAIL);
    const password = passwordSchema.safeParse(env.INITIAL_ADMIN_PASSWORD);
    if (!env.INITIAL_ADMIN_NAME || !email.success || !password.success) {
      throw new Error(
        "Set INITIAL_ADMIN_NAME, a valid INITIAL_ADMIN_EMAIL and an INITIAL_ADMIN_PASSWORD of at least 10 characters.",
      );
    }
    await User.create({
      name: env.INITIAL_ADMIN_NAME,
      email: email.data,
      passwordHash: await hashPassword(password.data),
      role: "admin",
      mustChangePassword: true,
    });
    console.log(
      `Initial administrator created: ${email.data}. Change the password at first login and remove INITIAL_ADMIN_PASSWORD from the environment.`,
    );
  }
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await disconnectDb();
  process.exit(1);
});
