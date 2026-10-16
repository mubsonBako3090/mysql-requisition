import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";

import Requisition from "@/models/Requisition";

import { ROLES } from "@/constants/roles";
import { REQUISITION_STATUS } from "@/constants/requisitionOptions";
import { COLLEGES } from "@/constants/colleges";

function getAuth() {
  const token = cookies().get("token")?.value;
  return token ? verifyToken(token) : null;
}

function getRequisitionUnits(requisition) {
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

function isWithinScope(requisition, auth) {
  if ([ROLES.VC, ROLES.PROCUREMENT, ROLES.ADMIN].includes(auth.role)) return true;

  const units = getRequisitionUnits(requisition);

  if (auth.role === ROLES.DEAN) {
    return units.every(
      (unit) =>
        String(unit.collegeId) === String(auth.collegeId) &&
        String(unit.facultyId) === String(auth.facultyId)
    );
  }

  if (auth.role === ROLES.PROVOST) {
    return units.every(
      (unit) => String(unit.collegeId) === String(auth.collegeId)
    );
  }

  return false;
}

/*
 * --------------------------------------------------
 * GET /api/requisitions/consolidate/organizations
 * --------------------------------------------------
 *
 * Returns requisitions that the logged-in user is
 * authorized to consolidate.
 *
 * Authority:
 *
 * DEAN
 *   -> faculties under their college
 *
 * PROVOST
 *   -> all faculties/departments under their college
 *
 * VC
 *   -> university-wide
 *
 * PROCUREMENT
 *   -> university-wide
 *
 * ADMIN
 *   -> university-wide
 */
export async function GET() {
  const auth = getAuth();

  if (!auth) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401 }
    );
  }

  const allowedRoles = [
    ROLES.DEAN,
    ROLES.PROVOST,
    ROLES.VC,
    ROLES.PROCUREMENT,
    ROLES.ADMIN,
  ];

  if (!allowedRoles.includes(auth.role)) {
    return NextResponse.json(
      {
        message:
          "Your role is not allowed to create consolidated requisitions.",
      },
      { status: 403 }
    );
  }

  await connectDB();

  /*
   * --------------------------------------------------
   * ELIGIBLE SOURCE REQUISITIONS
   * --------------------------------------------------
   *
   * Drafts and rejected requisitions are always excluded.
   * Beyond that, eligibility depends on WHEN each role is
   * meant to consolidate:
   *
   *  - Dean/Provost/VC: consolidating IS their approval
   *    action, so they may only pick requisitions that are
   *    actually sitting at their own step right now. For
   *    VC this also means the consolidated result is
   *    immediately finalized — VC is the last approval
   *    step, so there's nothing left to route it to.
   *  - Procurement/Admin: consolidation happens AFTER full
   *    approval, as a post-approval grouping step, so only
   *    already-VC-approved requisitions are eligible.
   */
  const isPreApprovalConsolidator =
    auth.role === ROLES.DEAN ||
    auth.role === ROLES.PROVOST ||
    auth.role === ROLES.VC;

  const isPostApprovalConsolidator =
    auth.role === ROLES.PROCUREMENT ||
    auth.role === ROLES.ADMIN;

  const statusFilter = isPreApprovalConsolidator
    ? [
        REQUISITION_STATUS.PENDING,
        REQUISITION_STATUS.RETURNED,
      ]
    : isPostApprovalConsolidator
    ? [
        REQUISITION_STATUS.PENDING,
        REQUISITION_STATUS.APPROVED,
      ]
    : [
        REQUISITION_STATUS.PENDING,
        REQUISITION_STATUS.RETURNED,
        REQUISITION_STATUS.APPROVED,
      ];

  const baseQuery = {
    status: {
      $in: statusFilter,
    },

    awaitingRequesterAction: {
      $ne: true,
    },

    consolidatedInto: {
      $exists: false,
    },
  };

  /*
   * --------------------------------------------------
   * APPLY ORGANIZATIONAL SCOPE
   * --------------------------------------------------
   */

  let query = {
    ...baseQuery,
  };

  // Organizational scope is applied after loading because a consolidated
  // requisition can represent several colleges/faculties and therefore does
  // not have a single reliable top-level organization field.


  /*
   * VC
   *
   * University-wide.
   *
   * No organizational restriction.
   */

  /*
   * PROCUREMENT
   *
   * University-wide.
   *
   * Procurement visits departments across the
   * university and can select requirements from
   * multiple colleges.
   */

  /*
   * ADMIN
   *
   * University-wide.
   */

  const requisitions =
    (
      await Requisition.find(query)
        .sort({
          collegeId: 1,
          facultyId: 1,
          department: 1,
          createdAt: 1,
        })
        .populate(
          "requester",
          "fullName email role"
        )
        .populate(
          "originalInitiators.requester",
          "fullName role"
        )
        .lean()
    ).filter((requisition) => {
      if (!isWithinScope(requisition, auth)) return false;

      /*
       * Dean/Provost: being in their scope isn't enough —
       * it must actually be THEIR turn to act on it right
       * now (not still with HOD, not already past them).
       */
      if (isPostApprovalConsolidator) {
        if (requisition.status === REQUISITION_STATUS.APPROVED) {
          // Only Procurement-accepted requisitions are eligible for the
          // final hand-off consolidation. Legacy processing/completed
          // records are deliberately excluded from the new boundary.
          return ["ready", "accepted"].includes(requisition.procurementStatus);
        }

        if (auth.role === ROLES.PROCUREMENT) {
          const step = requisition.approvalChain?.[requisition.currentStepIndex];
          const isProcurementIntake =
            requisition.status === REQUISITION_STATUS.PENDING &&
            step?.role === ROLES.PROCUREMENT &&
            step?.type === "procurement_review" &&
            // Older legitimate intake records may not have had this field
            // persisted. The current workflow step is the authoritative stage.
            ["review", undefined, null].includes(requisition.procurementStatus);

          const isMarketSurveyedForDirector =
            requisition.status === REQUISITION_STATUS.PENDING &&
            step?.role === ROLES.PROCUREMENT &&
            step?.type === "procurement_review" &&
            requisition.procurementStatus === "director_review" &&
            auth.procurementPosition === "director";

          if (!isProcurementIntake && !isMarketSurveyedForDirector) return false;

          if (isMarketSurveyedForDirector) {
            return String(step.approver) === String(auth.sub);
          }

          const supervisory =
            auth.procurementPosition === "director" ||
            auth.procurementPosition === "principal_senior";

          return supervisory || String(step.approver) === String(auth.sub);
        }

        return false;
      }

      const step =
        requisition.approvalChain?.[
          requisition.currentStepIndex
        ];

      return (
        step &&
        String(step.approver) ===
          String(auth.sub)
      );
    });

  /*
   * --------------------------------------------------
   * BUILD ORGANIZATIONAL TREE
   * --------------------------------------------------
   *
   * Result:
   *
   * College
   *   Faculty
   *     Department
   *       Requisitions
   */
  const organizationMap = new Map();

  for (const requisition of requisitions) {
    const displayUnit = getRequisitionUnits(requisition)[0] || {};
    const collegeId =
      displayUnit.collegeId || requisition.collegeId || "N/A";

    const facultyId =
      displayUnit.facultyId || requisition.facultyId || "N/A";

    const department =
      displayUnit.department || requisition.department || "N/A";

    if (!organizationMap.has(collegeId)) {
      organizationMap.set(collegeId, {
        collegeId,
        faculties: new Map(),
      });
    }

    const college =
      organizationMap.get(collegeId);

    if (!college.faculties.has(facultyId)) {
      college.faculties.set(
        facultyId,
        {
          facultyId,
          departments: new Map(),
        }
      );
    }

    const faculty =
      college.faculties.get(facultyId);

    if (!faculty.departments.has(department)) {
      faculty.departments.set(
        department,
        {
          department,
          requisitions: [],
        }
      );
    }

    faculty.departments
      .get(department)
      .requisitions
      .push(requisition);
  }

  /*
   * --------------------------------------------------
   * CONVERT MAPS TO ARRAYS
   * --------------------------------------------------
   */
  const organizations =
    [...organizationMap.values()].map(
      (college) => ({
        collegeId: college.collegeId,

        faculties: [
          ...college.faculties.values(),
        ].map((faculty) => ({
          facultyId: faculty.facultyId,

          departments: [
            ...faculty.departments.values(),
          ],
        })),
      })
    );

  return NextResponse.json({
    organizations,
  });
}
