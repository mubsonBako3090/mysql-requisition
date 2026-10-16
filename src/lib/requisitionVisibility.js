import { ROLES } from "@/constants/roles";
import { REQUISITION_STATUS } from "@/constants/requisitionOptions";
import { PROCUREMENT_POSITIONS } from "@/constants/procurement";

const PROCUREMENT_HISTORY_STATUSES = [
  "review",
  "director_review",
  "submitted_to_vc",
  "ready",
  "processing",
  "completed",
  "rejected",
];

function same(value, expected) {
  const left = value?._id ?? value;
  const right = expected?._id ?? expected;
  return String(left ?? "") === String(right ?? "");
}

function requisitionUnits(requisition) {
  if (requisition?.isConsolidated && Array.isArray(requisition.requestingUnits)) {
    return requisition.requestingUnits;
  }

  return [
    {
      collegeId: requisition?.collegeId,
      facultyId: requisition?.facultyId,
      department: requisition?.department,
    },
  ];
}

function isWithinOrganizationScope(auth, requisition) {
  const units = requisitionUnits(requisition);

  if (auth.role === ROLES.HOD) {
    return units.some(
      (unit) =>
        same(unit.collegeId, auth.collegeId) &&
        same(unit.facultyId, auth.facultyId) &&
        same(unit.department, auth.department)
    );
  }

  if (auth.role === ROLES.DEAN) {
    return units.some(
      (unit) =>
        same(unit.collegeId, auth.collegeId) &&
        same(unit.facultyId, auth.facultyId)
    );
  }

  if (auth.role === ROLES.PROVOST) {
    return units.some((unit) => same(unit.collegeId, auth.collegeId));
  }

  return false;
}

/**
 * Returns the database visibility scope for the authenticated user.
 * This is intentionally separate from approval routing: visibility is
 * broader than "whose turn is it?".
 */
export function getRequisitionVisibilityQuery(auth) {
  if (!auth) return null;

  switch (auth.role) {
    case ROLES.ADMIN:
    case ROLES.VC:
      return {};

    case ROLES.REQUESTER:
      return { requester: auth.sub };

    case ROLES.HOD:
      return {
        $or: [
          // An HOD sees their own original requisitions, but not a
          // consolidated representative created from those requisitions.
          {
            requester: auth.sub,
            isConsolidated: { $ne: true },
          },
          {
            collegeId: auth.collegeId,
            facultyId: auth.facultyId,
            department: auth.department,
            isConsolidated: { $ne: true },
          },
          // A consolidated representative is visible to the user who
          // actually performed the consolidation (for example a Dean),
          // not to every source HOD represented by it.
          { consolidatedBy: auth.sub },
        ],
      };

    case ROLES.DEAN:
      return {
        $or: [
          { requester: auth.sub, isConsolidated: { $ne: true } },
          {
            collegeId: auth.collegeId,
            facultyId: auth.facultyId,
            isConsolidated: { $ne: true },
          },
          {
            requestingUnits: {
              $elemMatch: {
                collegeId: auth.collegeId,
                facultyId: auth.facultyId,
              },
            },
            isConsolidated: { $ne: true },
          },
          { consolidatedBy: auth.sub },
        ],
      };

    case ROLES.PROVOST:
      return {
        $or: [
          { requester: auth.sub, isConsolidated: { $ne: true } },
          { collegeId: auth.collegeId, isConsolidated: { $ne: true } },
          {
            requestingUnits: {
              $elemMatch: {
                collegeId: auth.collegeId,
              },
            },
            isConsolidated: { $ne: true },
          },
          { consolidatedBy: auth.sub },
        ],
      };

    case ROLES.PROCUREMENT: {
      const position = auth.procurementPosition;
      const isDirector =
        position === PROCUREMENT_POSITIONS.DIRECTOR;
      const isSenior = [
        PROCUREMENT_POSITIONS.PRINCIPAL_SENIOR,
      ].includes(position);

      // Procurement visibility is workflow-based, not a blanket view of
      // every requisition in the university.
      const workflow = {
        procurementStatus: {
          $in: PROCUREMENT_HISTORY_STATUSES,
        },
      };

      if (isDirector || isSenior) {
        return {
          $or: [
            { requester: auth.sub },
            workflow,
            { procurementOfficer: auth.sub },
            { procurementAssignedTo: auth.sub },
            { procurementAssignedBy: auth.sub },
          ],
        };
      }

      return {
        $or: [
          { requester: auth.sub },
          { procurementOfficer: auth.sub },
          { procurementAssignedTo: auth.sub },
          { procurementAssignedBy: auth.sub },
        ],
      };
    }

    default:
      return { requester: auth.sub };
  }
}

/**
 * Applies a requested status without weakening the user's visibility scope.
 */
export function withStatusFilter(query, status) {
  if (!status) return query;
  return { $and: [query, { status }] };
}

/**
 * Final defensive check used after a broader Mongo query when populated
 * documents or legacy records make an exact scope check useful.
 */
export function canViewRequisition(auth, requisition) {
  if (!auth || !requisition) return false;

  if ([ROLES.ADMIN, ROLES.VC].includes(auth.role)) return true;

  // A source HOD should see the original requisition represented in a
  // consolidation, not the consolidated representative as a duplicate.
  // The representative remains visible to its actual consolidator.
  if (auth.role === ROLES.HOD && requisition.isConsolidated) {
    return same(requisition.consolidatedBy, auth.sub);
  }

  if (same(requisition.requester?._id || requisition.requester, auth.sub)) return true;

  // Anyone who is explicitly the approver of the CURRENT workflow step
  // must be able to open the requisition from that role's queue. This is
  // intentionally checked before organizational-scope rules so queue links
  // cannot produce a false "not authorized" response.
  const currentStep = requisition.approvalChain?.[requisition.currentStepIndex];
  if (currentStep && same(currentStep.approver, auth.sub)) {
    if (currentStep.type === "approval" && currentStep.role === auth.role) {
      return true;
    }

    if (
      auth.role === ROLES.PROCUREMENT &&
      currentStep.type === "procurement_review" &&
      currentStep.role === ROLES.PROCUREMENT
    ) {
      return true;
    }

    if (
      auth.role === ROLES.PROCUREMENT &&
      currentStep.type === "processing" &&
      currentStep.role === ROLES.PROCUREMENT
    ) {
      return true;
    }
  }

  if (auth.role === ROLES.REQUESTER) return false;

  if (
    auth.role === ROLES.HOD ||
    auth.role === ROLES.DEAN ||
    auth.role === ROLES.PROVOST
  ) {
    return isWithinOrganizationScope(auth, requisition);
  }

  if (auth.role === ROLES.PROCUREMENT) {
    const position = auth.procurementPosition;
    const isDirector = position === PROCUREMENT_POSITIONS.DIRECTOR;
    const isSenior = position === PROCUREMENT_POSITIONS.PRINCIPAL_SENIOR;

    if (
      same(requisition.procurementOfficer, auth.sub) ||
      same(requisition.procurementAssignedTo, auth.sub) ||
      same(requisition.procurementAssignedBy, auth.sub)
    ) return true;

    if (
      currentStep?.role === ROLES.PROCUREMENT &&
      currentStep?.type === "procurement_review" &&
      (isDirector || isSenior || same(currentStep.approver, auth.sub))
    ) return true;

    return Boolean(
      (isDirector || isSenior) &&
      PROCUREMENT_HISTORY_STATUSES.includes(requisition.procurementStatus)
    );
  }

  return false;
}

export { PROCUREMENT_HISTORY_STATUSES };
