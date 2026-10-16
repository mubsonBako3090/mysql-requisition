import { ensureSchema } from "@/lib/orm";

// Register every model so tables are created and populate() can resolve refs.
import "@/models/User";
import "@/models/Requisition";
import "@/models/Approval";
import "@/models/AuditLog";
import "@/models/Notification";

/*
 * Connects lazily (the pool is created on first query) and makes sure the
 * tables exist. The result is cached across hot reloads and warm serverless
 * invocations. Set MYSQL_AUTO_MIGRATE=false to skip table creation, e.g. when
 * you load database/schema.sql yourself.
 */
export async function connectDB() {
  if (!global._mysqlReady) {
    global._mysqlReady = ensureSchema().catch((error) => {
      global._mysqlReady = null;
      throw error;
    });
  }

  await global._mysqlReady;
  return true;
}
