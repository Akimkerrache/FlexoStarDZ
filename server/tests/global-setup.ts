import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer | undefined;

export async function setup() {
  mongod = await MongoMemoryServer.create();
  process.env.TEST_MONGODB_URI = mongod.getUri('flexostar_test');
}

export async function teardown() {
  await mongod?.stop();
}
