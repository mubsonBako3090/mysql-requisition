/*
 * Procurement Directorate / PMU positions used by the requisition workflow.
 *
 * The project models only the roles needed for the digital requisition stage.
 * It does NOT attempt to model tender execution, vendor award, delivery, or
 * Stores processing.
 */
export const PROCUREMENT_POSITIONS = {
  DIRECTOR: "director",
  PRINCIPAL_SENIOR: "principal_senior",
  PROCUREMENT_OFFICER_I: "procurement_officer_i",
  PROCUREMENT_OFFICER_II: "procurement_officer_ii",
  ADMIN_SUPPORT: "admin_support",
};

export const PROCUREMENT_POSITION_LABELS = {
  [PROCUREMENT_POSITIONS.DIRECTOR]: "Director of Procurement",
  [PROCUREMENT_POSITIONS.PRINCIPAL_SENIOR]: "Principal / Senior Procurement Officer",
  [PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_I]: "Procurement Officer I",
  [PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_II]: "Procurement Officer II",
  [PROCUREMENT_POSITIONS.ADMIN_SUPPORT]: "Administrative / Clerical Officer",
};

export const PROCUREMENT_MARKET_SURVEY_POSITIONS = [
  PROCUREMENT_POSITIONS.PRINCIPAL_SENIOR,
  PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_I,
  PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_II,
];

export const PROCUREMENT_ASSIGNMENT_POSITIONS = [
  PROCUREMENT_POSITIONS.DIRECTOR,
  PROCUREMENT_POSITIONS.PRINCIPAL_SENIOR,
];

export const PROCUREMENT_OPERATIONAL_POSITIONS = [
  PROCUREMENT_POSITIONS.PRINCIPAL_SENIOR,
  PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_I,
  PROCUREMENT_POSITIONS.PROCUREMENT_OFFICER_II,
];
