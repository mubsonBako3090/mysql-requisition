import { defineModel } from "../lib/orm.js";
import { APPROVAL_ACTIONS } from "../constants/requisitionOptions.js";

/*
 * Stores actual approval decisions.
 *
 * Procurement processing is NOT stored as an approval because Procurement
 * does not approve the requisition after VC approval.
 */
export default defineModel({
  name: "Approval",
  table: "approvals",
  collection: "approvals",
  fields: {
    requisition: { type: "id", ref: "Requisition", required: true },
    stepIndex: { type: "int", required: true },
    role: { type: "string", required: true, maxlength: 50 },
    approver: { type: "id", ref: "User", required: true },
    action: {
      type: "string",
      enum: Object.values(APPROVAL_ACTIONS),
      required: true,
      maxlength: 40,
    },
    comment: { type: "text" },
    seedTag: { type: "string", maxlength: 40 },
  },
  indexes: [
    { columns: ["requisition"] },
    { columns: ["approver", "createdAt"] },
  ],
});
