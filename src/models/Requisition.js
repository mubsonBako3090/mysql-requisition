import { defineModel } from "../lib/orm.js";
import { REQUISITION_STATUS } from "../constants/requisitionOptions.js";

const now = () => new Date();

/*
 * Nested data is stored in JSON columns:
 *
 *   items                          [{ name, quantity, unitCost, totalCost, ... }]
 *   attachments                    [{ url, publicId, fileName, fileType, uploadedAt }]
 *   comments                       [{ author, message, createdAt }]
 *   approvalChain                  [{ role, approver, type }]
 *   sourceRequisitions             [requisitionId, ...]
 *   originalInitiators             [{ requester, role, requisition }]
 *   requestingUnits                [{ collegeId, facultyId, department }]
 *   procurementPriceHistory        [{ revision, itemName, itemIndex, ... changedBy, changedAt }]
 *   procurementAssignmentHistory   [{ assignedTo, assignedBy, assignedAt, note }]
 *
 * Item fields (see lib/validators/requisition.js for validation):
 *   name, requestingCollegeId, requestingFacultyId, requestingDepartment,
 *   sourceRequisitionId, quantity, unitCost, requestedUnitCost,
 *   requestedTotalCost, procurementUnitCost, procurementNote, totalCost
 *
 * approvalChain step `type`: "approval" | "procurement_review" | "processing"
 */
export default defineModel({
  name: "Requisition",
  table: "requisitions",
  collection: "requisitions",
  fields: {
    requisitionNumber: { type: "string", maxlength: 40 },

    requester: { type: "id", ref: "User", required: true },
    requesterRole: { type: "string", required: true, maxlength: 50 },

    // Consolidated requisition
    isConsolidated: { type: "bool", default: false },
    sourceRequisitions: { type: "json", array: true, ref: "Requisition", default: [] },
    consolidatedBy: { type: "id", ref: "User" },
    consolidatedByRole: { type: "string", maxlength: 50 },
    originalInitiators: {
      type: "json",
      array: true,
      refs: { requester: "User", requisition: "Requisition" },
    },
    consolidatedInto: { type: "id", ref: "Requisition" },
    consolidatedAt: { type: "date" },
    requestingUnits: { type: "json", array: true },

    // Organizational snapshot (not required for consolidated requisitions)
    collegeId: { type: "string", requiredIf: (d) => !d.isConsolidated },
    facultyId: { type: "string", requiredIf: (d) => !d.isConsolidated },
    department: { type: "string", requiredIf: (d) => !d.isConsolidated },

    // Details
    category: { type: "string" },
    purpose: { type: "text" },
    urgency: { type: "string", maxlength: 50 },

    items: {
      type: "json",
      array: true,
      default: [],
      refs: { sourceRequisitionId: "Requisition" },
    },
    estimatedCost: { type: "decimal", default: 0 },

    attachments: {
      type: "json",
      array: true,
      default: [],
      dates: ["uploadedAt"],
      itemDefaults: { uploadedAt: now },
    },
    comments: {
      type: "json",
      array: true,
      default: [],
      refs: { author: "User" },
      dates: ["createdAt"],
      itemDefaults: { createdAt: now },
    },

    // Main status: draft | pending | returned | approved | rejected
    status: {
      type: "string",
      enum: Object.values(REQUISITION_STATUS),
      default: REQUISITION_STATUS.DRAFT,
      maxlength: 30,
    },

    approvalChain: {
      type: "json",
      array: true,
      default: [],
      refs: { approver: "User" },
    },
    currentStepIndex: { type: "int", default: 0 },
    awaitingRequesterAction: { type: "bool", default: false },
    requiresGovernorApproval: { type: "bool", default: false },
    finalApprovalAt: { type: "date" },

    // Procurement
    procurementStatus: {
      type: "string",
      enum: [
        "review",
        "director_review",
        "submitted_to_vc",
        "ready",
        "processing",
        "completed",
        "rejected",
      ],
      maxlength: 30,
    },
    procurementReviewStartedAt: { type: "date" },
    submittedToVcAt: { type: "date" },
    boqGeneratedAt: { type: "date" },
    procurementRevision: { type: "int", default: 0 },
    procurementNotes: { type: "text", trim: true },
    procurementPriceHistory: {
      type: "json",
      array: true,
      default: [],
      refs: { changedBy: "User" },
      dates: ["changedAt"],
      itemDefaults: { changedAt: now },
    },
    procurementOfficer: { type: "id", ref: "User" },
    procurementAssignedTo: { type: "id", ref: "User" },
    procurementAssignedAt: { type: "date" },
    procurementAssignedBy: { type: "id", ref: "User" },
    procurementAssignmentHistory: {
      type: "json",
      array: true,
      default: [],
      refs: { assignedTo: "User", assignedBy: "User" },
      dates: ["assignedAt"],
      itemDefaults: { assignedAt: now },
    },
    procurementReceivedAt: { type: "date" },
    procurementStartedAt: { type: "date" },
    procurementCompletedAt: { type: "date" },

    // Timestamps
    submittedAt: { type: "date" },
    decidedAt: { type: "date" },

    // Final rejection traceability
    rejectedBy: { type: "id", ref: "User" },
    rejectedByRole: { type: "string", maxlength: 50 },
    rejectedByName: { type: "string" },
    rejectedAt: { type: "date" },
    rejectionComment: { type: "text" },

    seedTag: { type: "string", maxlength: 40 },
  },
  indexes: [
    { columns: ["requisitionNumber"], unique: true },
    { columns: ["requester"] },
    { columns: ["status"] },
    { columns: ["collegeId", "facultyId"] },
    { columns: ["procurementStatus"] },
    { columns: ["consolidatedInto"] },
    { columns: ["createdAt"] },
  ],
});
