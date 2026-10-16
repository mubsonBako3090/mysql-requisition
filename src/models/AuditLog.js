import { defineModel } from "../lib/orm.js";

// Logs every status change, login, and edit across the system.
export default defineModel({
  name: "AuditLog",
  table: "audit_logs",
  collection: "auditlogs",
  fields: {
    actor: { type: "id", ref: "User" }, // null for system-generated events
    action: { type: "string", required: true }, // e.g. "login", "requisition.submit", "user.edit"
    entityType: { type: "string", maxlength: 50 }, // "User" | "Requisition" | "Approval"
    entityId: { type: "id" },
    details: { type: "json" }, // free-form: before/after, comment, ip, etc.
    seedTag: { type: "string", maxlength: 40 },
  },
  indexes: [
    { columns: ["createdAt"] },
    { columns: ["actor"] },
    { columns: ["action"] },
  ],
});
