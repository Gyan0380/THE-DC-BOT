const { MongoClient } = require("mongodb");
let client;
let database;

async function connectDb() {
  if (database) return database;
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing");
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  database = client.db(process.env.MONGODB_DB || "the_dc_bot");
  await database.collection("giveaways").createIndex({ endsAt: 1 });
  await database.collection("modlogs").createIndex({ guildId: 1, userId: 1, createdAt: -1 });
  await database.collection("settings").createIndex({ guildId: 1 }, { unique: true });
  return database;
}
function getDb() {
  if (!database) throw new Error("Database not connected");
  return database;
}
async function closeDb() {
  if (client) await client.close();
  client = undefined;
  database = undefined;
}
module.exports = { connectDb, getDb, closeDb };
