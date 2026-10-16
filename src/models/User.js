import { defineModel } from "../lib/orm.js";
import { ALL_ROLES } from "../constants/roles.js";
import { PROCUREMENT_POSITIONS } from "../constants/procurement.js";

export default defineModel({
  name: "User",
  table: "users",
  fields: {
    fullName: { type: "string", required: true, trim: true },
    email: { type: "string", required: true, lowercase: true, trim: true },
    passwordHash: { type: "string", required: true },
    role: { type: "string", required: true, enum: ALL_ROLES, maxlength: 50 },

    /*
     * Procurement Directorate position. Intentionally separate from the
     * system role because several staff ranks share the PROCUREMENT role
     * but have different responsibilities.
     */
    procurementPosition: {
      type: "string",
      enum: Object.values(PROCUREMENT_POSITIONS),
      default: PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_II,
      maxlength: 50,
    },

    // Organizational placement
    collegeId: { type: "string", required: true },
    facultyId: { type: "string", required: true },
    department: { type: "string", required: true },

    // Account status
    accountStatus: {
      type: "string",
      enum: ["pending", "active", "deactivated"],
      default: "pending",
      maxlength: 20,
    },

    // System administrator
    isSystemAdmin: { type: "bool", default: false },

    // Password reset
    passwordResetToken: { type: "string" },
    passwordResetExpires: { type: "date" },

    // Login
    lastLoginAt: { type: "date" },

    // Set only by the seed scripts so seeded rows can be removed again.
    seedTag: { type: "string", maxlength: 40 },
  },
  indexes: [
    { columns: ["email"], unique: true },
    { columns: ["role"] },
    { columns: ["collegeId", "facultyId"] },
    { columns: ["accountStatus"] },
  ],
});
