// Prints the CREATE TABLE statements for every model: npm run db:schema > database/schema.sql
import { schemaSQL } from "../src/lib/orm.js";
import "../src/models/User.js";
import "../src/models/Requisition.js";
import "../src/models/Approval.js";
import "../src/models/AuditLog.js";
import "../src/models/Notification.js";

process.stdout.write(schemaSQL());
