import { defineModel } from "../lib/orm.js";

export default defineModel({
  name: "Notification",
  table: "notifications",
  collection: "notifications",
  fields: {
    recipient: { type: "id", ref: "User", required: true },
    title: { type: "string", required: true, trim: true, maxlength: 160 },
    message: { type: "string", required: true, trim: true, maxlength: 1000 },
    type: {
      type: "string",
      enum: ["info", "success", "warning", "error"],
      default: "info",
      maxlength: 20,
    },
    requisition: { type: "id", ref: "Requisition" },
    requisitionNumber: { type: "string", trim: true, maxlength: 60 },
    href: { type: "string", default: "/notifications" },
    readAt: { type: "date", default: null, keepNull: true },
    seedTag: { type: "string", maxlength: 40 },
  },
  indexes: [{ columns: ["recipient", "readAt", "createdAt"] }],
});
