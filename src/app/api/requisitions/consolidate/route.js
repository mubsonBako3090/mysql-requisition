import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";

import Requisition from "@/models/Requisition";
import AuditLog from "@/models/AuditLog";
import Approval from "@/models/Approval";
import User from "@/models/User";

import { generateRequisitionNumber } from "@/services/requisitionService";
import { syncConsolidatedSourcesAfterApproval } from "@/services/approvalService";

import { ROLES } from "@/constants/roles";
import { buildApprovalChain } from "@/lib/routing";
import { REQUISITION_STATUS, URGENCY_LEVELS } from "@/constants/requisitionOptions";

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

function isWithinRoleScope(requisition, auth) {
  if (auth.role === ROLES.VC || auth.role === ROLES.PROCUREMENT || auth.role === ROLES.ADMIN) {
    return true;
  }

  const units = getRequisitionUnits(requisition);

  if (auth.role === ROLES.DEAN) {
    return Boolean(
      auth.collegeId &&
      auth.facultyId &&
      units.every(
        (unit) =>
          String(unit.collegeId) === String(auth.collegeId) &&
          String(unit.facultyId) === String(auth.facultyId)
      )
    );
  }

  if (auth.role === ROLES.PROVOST) {
    return Boolean(
      auth.collegeId &&
      units.every(
        (unit) => String(unit.collegeId) === String(auth.collegeId)
      )
    );
  }

  return false;
}

async function collectOriginalInitiators(sourceRequisitions) {
  const result = new Map();
  const visited = new Set();

  async function walk(requisition) {
    const id = String(requisition._id);
    if (visited.has(id)) return;
    visited.add(id);

    if (
      Array.isArray(requisition.originalInitiators) &&
      requisition.originalInitiators.length > 0
    ) {
      for (const entry of requisition.originalInitiators) {
        if (!entry?.requester) continue;
        const requesterId = String(entry.requester?._id || entry.requester);
        result.set(requesterId, {
          requester: entry.requester?._id || entry.requester,
          role: entry.role || requisition.requesterRole,
          requisition: entry.requisition || requisition._id,
        });
      }
      return;
    }

    if (requisition.isConsolidated && requisition.sourceRequisitions?.length) {
      const children = await Requisition.find({
        _id: { $in: requisition.sourceRequisitions },
      })
        .select("requester requesterRole isConsolidated sourceRequisitions originalInitiators")
        .lean();

      for (const child of children) {
        await walk(child);
      }
      return;
    }

    const requesterId = String(requisition.requester?._id || requisition.requester || "");
    if (requesterId) {
      result.set(requesterId, {
        requester: requisition.requester?._id || requisition.requester,
        role: requisition.requesterRole || requisition.requester?.role,
        requisition: requisition._id,
      });
    }
  }

  for (const requisition of sourceRequisitions) {
    await walk(requisition);
  }

  return [...result.values()];
}

/*
 * --------------------------------------------------
 * ALLOWED CONSOLIDATION ROLES
 * --------------------------------------------------
 */
const CONSOLIDATION_ROLES = [
  ROLES.DEAN,
  ROLES.PROVOST,
  ROLES.VC,
  ROLES.PROCUREMENT,
  ROLES.ADMIN,
];

// Kept in sync with the canonical urgency levels used across the app,
// instead of a separately-maintained list that can drift out of sync.
const ALLOWED_URGENCIES = URGENCY_LEVELS.map((u) => u.value);

/*
 * --------------------------------------------------
 * POST /api/requisitions/consolidate
 * --------------------------------------------------
 *
 * Creates ONE new requisition from multiple
 * existing requisitions.
 */
export async function POST(request) {
  const auth = getAuth();

  if (!auth) {
    return NextResponse.json(
      { message: "Unauthorized" },
      { status: 401 }
    );
  }

  if (!CONSOLIDATION_ROLES.includes(auth.role)) {
    return NextResponse.json(
      {
        message:
          "Your role is not authorized to create consolidated requisitions.",
      },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();

    const {
      requisitionIds,
      category: providedCategory,
      urgency,
      purpose,
    } = body;

    /*
     * --------------------------------------------------
     * BASIC VALIDATION
     * --------------------------------------------------
     */

    if (!Array.isArray(requisitionIds) || requisitionIds.length === 0) {
      return NextResponse.json(
        { message: "Select at least one requisition." },
        { status: 400 }
      );
    }

    // Prevent duplicate IDs.
    const uniqueIds = [...new Set(requisitionIds.map((id) => String(id)))];
    if (uniqueIds.length !== requisitionIds.length) {
      return NextResponse.json(
        { message: "A requisition cannot be selected more than once." },
        { status: 400 }
      );
    }

    if (!purpose?.trim()) {
      return NextResponse.json(
        { message: "A purpose is required." },
        { status: 400 }
      );
    }

    if (!providedCategory?.trim()) {
      return NextResponse.json(
        { message: "Category is required." },
        { status: 400 }
      );
    }

    // Validate urgency if provided, or make it required.
    if (!urgency?.trim()) {
      return NextResponse.json(
        { message: "Urgency is required." },
        { status: 400 }
      );
    }
    if (!ALLOWED_URGENCIES.includes(urgency.toLowerCase())) {
      return NextResponse.json(
        { message: `Urgency must be one of: ${ALLOWED_URGENCIES.join(", ")}.` },
        { status: 400 }
      );
    }

    await connectDB();

    /*
     * --------------------------------------------------
     * LOAD SOURCE REQUISITIONS
     * --------------------------------------------------
     *
     * Eligibility depends on WHEN each role is meant to
     * consolidate (see organizations/route.js for the
     * same reasoning):
     *
     *  - Dean/Provost/VC: only requisitions pending/
     *    returned (consolidating is their approval action).
     *  - Procurement/Admin: only already-VC-approved
     *    requisitions (post-approval grouping).
     */
    const isPreApprovalConsolidator =
      auth.role === ROLES.DEAN ||
      auth.role === ROLES.PROVOST ||
      auth.role === ROLES.VC;

    const isPostApprovalConsolidator =
      auth.role === ROLES.PROCUREMENT ||
      auth.role === ROLES.ADMIN;

    const statusFilter = isPreApprovalConsolidator
      ? [REQUISITION_STATUS.PENDING, REQUISITION_STATUS.RETURNED]
      : [REQUISITION_STATUS.PENDING, REQUISITION_STATUS.APPROVED];

    const sourceRequisitions = await Requisition.find({
      _id: { $in: uniqueIds },
      status: { $in: statusFilter },
      awaitingRequesterAction: { $ne: true },
      $or: [
        { isConsolidated: true, consolidatedInto: { $exists: false } },
        { isConsolidated: { $ne: true }, consolidatedInto: { $exists: false } },
      ],
    }).lean();

    if (sourceRequisitions.length !== uniqueIds.length) {
      return NextResponse.json(
        {
          message: isPreApprovalConsolidator
            ? "One or more selected requisitions are not currently pending your approval."
            : "One or more selected requisitions are not eligible for Procurement consolidation.",
        },
        { status: 400 }
      );
    }

    const procurementIntakeSources = sourceRequisitions.filter((requisition) => {
      const step = requisition.approvalChain?.[requisition.currentStepIndex];
      return (
        requisition.status === REQUISITION_STATUS.PENDING &&
        step?.role === ROLES.PROCUREMENT &&
        step?.type === "procurement_review" &&
        // Treat an unset status as intake only when the active approval step
        // explicitly places the requisition in Procurement Review.
        ["review", undefined, null].includes(requisition.procurementStatus)
      );
    });

    // After the assigned officer completes a market survey, the
    // Procurement Director can consolidate those surveyed requisitions
    // before sending the resulting representative to the VC.
    const marketSurveyedSources = sourceRequisitions.filter((requisition) => {
      const step = requisition.approvalChain?.[requisition.currentStepIndex];
      const allItemsSurveyed = Array.isArray(requisition.items) &&
        requisition.items.length > 0 &&
        requisition.items.every(
          (item) => item.procurementUnitCost !== undefined && item.procurementUnitCost !== null
        );

      return (
        requisition.status === REQUISITION_STATUS.PENDING &&
        step?.role === ROLES.PROCUREMENT &&
        step?.type === "procurement_review" &&
        requisition.procurementStatus === "director_review" &&
        allItemsSurveyed
      );
    });

    const acceptedProcurementSources = sourceRequisitions.filter((requisition) =>
      requisition.status === REQUISITION_STATUS.APPROVED &&
      ["ready", "accepted"].includes(requisition.procurementStatus)
    );

    if (isPostApprovalConsolidator && auth.role === ROLES.PROCUREMENT) {
      const approvedSources = sourceRequisitions.filter(
        (requisition) => requisition.status === REQUISITION_STATUS.APPROVED
      );

      if (
        (procurementIntakeSources.length > 0 || marketSurveyedSources.length > 0) &&
        approvedSources.length > 0
      ) {
        return NextResponse.json(
          {
            message:
              "Select requisitions from the same Procurement stage. Do not mix Procurement intake, market-surveyed, and already-accepted requisitions in one consolidation.",
          },
          { status: 400 }
        );
      }

      if (
        procurementIntakeSources.length > 0 &&
        marketSurveyedSources.length > 0
      ) {
        return NextResponse.json(
          {
            message:
              "Do not mix Procurement intake requisitions with market-surveyed requisitions. Complete the market survey first, then consolidate the surveyed requisitions for the Director's VC submission.",
          },
          { status: 400 }
        );
      }

      if (procurementIntakeSources.length > 0) {
        const supervisory =
          auth.procurementPosition === "director" ||
          auth.procurementPosition === "principal_senior";
        const unauthorizedIntake = procurementIntakeSources.some((requisition) => {
          const step = requisition.approvalChain?.[requisition.currentStepIndex];
          return !supervisory && String(step?.approver) !== String(auth.sub);
        });
        if (unauthorizedIntake) {
          return NextResponse.json(
            {
              message:
                "You can only consolidate Procurement intake requisitions assigned to you.",
            },
            { status: 403 }
          );
        }
      }

      if (marketSurveyedSources.length > 0 && auth.procurementPosition !== "director") {
        return NextResponse.json(
          {
            message:
              "Only the Procurement Director can consolidate market-surveyed requisitions for VC review.",
          },
          { status: 403 }
        );
      }
    }

    /*
     * Dean/Provost/VC: being in scope isn't enough — it
     * must actually be THEIR turn on every selected
     * requisition right now, since consolidating doubles
     * as approving.
     */
    if (isPreApprovalConsolidator) {
      const notMyTurn = sourceRequisitions.some((requisition) => {
        const step = requisition.approvalChain?.[requisition.currentStepIndex];
        return !step || String(step.approver) !== String(auth.sub);
      });

      if (notMyTurn) {
        return NextResponse.json(
          {
            message:
              "One or more selected requisitions are not currently pending your approval.",
          },
          { status: 400 }
        );
      }
    }

    /*
     * --------------------------------------------------
     * CATEGORY CONSISTENCY CHECK
     * --------------------------------------------------
     */
    const sourceCategories = [
      ...new Set(sourceRequisitions.map((r) => r.category)),
    ];
    // Filter out undefined/null categories, though they shouldn't happen.
    const validSourceCategories = sourceCategories.filter((c) => c != null);
    if (validSourceCategories.length > 1) {
      return NextResponse.json(
        {
          message:
            "All requisitions in a consolidated requisition must belong to the same category.",
        },
        { status: 400 }
      );
    }
    const sourceCategory = validSourceCategories[0]; // all same

    // Ensure the provided category matches the source category.
    if (providedCategory.trim() !== sourceCategory) {
      return NextResponse.json(
        {
          message:
            "Provided category does not match the category of the source requisitions.",
        },
        { status: 400 }
      );
    }

    /*
     * --------------------------------------------------
     * AUTHORITY CHECK
     * --------------------------------------------------
     */
    for (const requisition of sourceRequisitions) {
      if (!isWithinRoleScope(requisition, auth)) {
        return NextResponse.json(
          {
            message:
              auth.role === ROLES.DEAN
                ? "A Dean can only consolidate requisitions from their own faculty."
                : "A Provost can only consolidate requisitions from their own college.",
          },
          { status: 403 }
        );
      }
    }

    /*
     * --------------------------------------------------
     * BUILD DEPARTMENT-SPECIFIC ITEMS
     * --------------------------------------------------
     */
    const consolidatedItems = [];
    for (const requisition of sourceRequisitions) {
      const sourceUnits = getRequisitionUnits(requisition);
      const fallbackUnit = sourceUnits[0] || {};

      for (const item of requisition.items || []) {
        consolidatedItems.push({
          name: item.name,
          requestingCollegeId:
            item.requestingCollegeId || fallbackUnit.collegeId,
          requestingFacultyId:
            item.requestingFacultyId || fallbackUnit.facultyId,
          requestingDepartment:
            item.requestingDepartment || fallbackUnit.department,
          // The direct source is the owner of this copied item. If the
          // source is itself consolidated, its descendants remain reachable
          // through that source's own sourceRequisitions tree.
          sourceRequisitionId: requisition._id,
          quantity: Number(item.quantity || 0),
          unitCost: Number(item.unitCost || 0),
          requestedUnitCost: item.requestedUnitCost,
          requestedTotalCost: item.requestedTotalCost,
          procurementUnitCost: item.procurementUnitCost,
          procurementNote: item.procurementNote,
          totalCost: Number(
            item.totalCost ??
              (Number(item.quantity || 0) * Number(item.unitCost || 0))
          ),
        });
      }
    }

    if (consolidatedItems.length === 0) {
      return NextResponse.json(
        { message: "The selected requisitions contain no items." },
        { status: 400 }
      );
    }

    /*
     * --------------------------------------------------
     * CALCULATE TOTAL
     * --------------------------------------------------
     */
    const estimatedCost = consolidatedItems.reduce(
      (sum, item) => sum + Number(item.totalCost || 0),
      0
    );

    /*
     * --------------------------------------------------
     * ORGANIZATIONAL UNITS (deduplicated)
     * --------------------------------------------------
     */
    const unitMap = new Map();
    for (const requisition of sourceRequisitions) {
      for (const unit of getRequisitionUnits(requisition)) {
        const key = [
          unit.collegeId,
          unit.facultyId,
          unit.department,
        ].join("|");
        if (!unitMap.has(key)) {
          unitMap.set(key, {
            collegeId: unit.collegeId,
            facultyId: unit.facultyId,
            department: unit.department,
          });
        }
      }
    }
    const requestingUnits = [...unitMap.values()];

    // Derive a shared collegeId/facultyId when every source unit agrees,
    // even if they don't agree on department — this lets the approval
    // chain still route a Dean's (same faculty) or Provost's (same
    // college) multi-unit consolidation correctly. "N/A" only when the
    // units genuinely disagree (Procurement/VC consolidating across
    // colleges), where routing doesn't need a single college anyway.
    const distinctColleges = [
      ...new Set(requestingUnits.map((u) => u.collegeId)),
    ];
    const distinctFaculties = [
      ...new Set(requestingUnits.map((u) => u.facultyId)),
    ];
    const commonCollegeId =
      distinctColleges.length === 1 ? distinctColleges[0] : "N/A";
    const commonFacultyId =
      distinctColleges.length === 1 && distinctFaculties.length === 1
        ? distinctFaculties[0]
        : "N/A";

    const singleUnit =
      requestingUnits.length === 1 ? requestingUnits[0] : null;

    /*
     * --------------------------------------------------
     * DETERMINE OUTCOME
     * --------------------------------------------------
     *
     * Dean/Provost: consolidating IS their approval, so
     * the merged requisition still needs to go through
     * whatever's above them — created as a draft, then the
     * frontend immediately offers "Send to Next Approver"
     * (the existing submit endpoint), which builds the
     * approval chain starting at the next role up.
     *
     * VC: consolidating IS their approval too, but VC is
     * the LAST approval step — there's nothing left to
     * route it to. The merged requisition is finalized on
     * the spot, exactly like a normal final VC approval.
     *
     * Procurement/Admin: every source already cleared VC
     * approval individually, so re-running the whole chain
     * would be redundant — the merged requisition is
     * created already approved and ready for processing,
     * the same state a normal requisition reaches only
     * after full approval.
     *
     * VC and Procurement/Admin end up in the same finalized
     * state; only how the Procurement Officer is resolved
     * differs (VC isn't Procurement, so look up an active
     * one; Procurement finalizing their own consolidation
     * become the officer themselves).
     */

    const isProcurementIntakeConsolidation =
      auth.role === ROLES.PROCUREMENT &&
      procurementIntakeSources.length === sourceRequisitions.length;

    const isMarketSurveyedProcurementConsolidation =
      auth.role === ROLES.PROCUREMENT &&
      auth.procurementPosition === "director" &&
      marketSurveyedSources.length === sourceRequisitions.length;

    const isFinalizedOutcome =
      auth.role === ROLES.VC ||
      (isPostApprovalConsolidator &&
        !isProcurementIntakeConsolidation &&
        !isMarketSurveyedProcurementConsolidation);

    let procurementOfficer = null;

    if (isFinalizedOutcome) {
      procurementOfficer =
        auth.role === ROLES.PROCUREMENT
          ? await User.findById(auth.sub)
          : await User.findOne({
              role: ROLES.PROCUREMENT,
              accountStatus: "active",
            });

      if (!procurementOfficer) {
        return NextResponse.json(
          {
            message:
              "No active Procurement Officer is configured.",
          },
          { status: 400 }
        );
      }
    }

    const now = new Date();

    /*
     * Accepted Procurement consolidation is the final hand-off document.
     * The selected sources have already completed institutional approval,
     * so the new representative must not restart the approval chain or
     * create another market-survey/VC step.
     */
    const isAcceptedProcurementConsolidation =
      auth.role === ROLES.PROCUREMENT &&
      acceptedProcurementSources.length === sourceRequisitions.length;

    const intakeSourceChain =
      (isProcurementIntakeConsolidation || isMarketSurveyedProcurementConsolidation)
        ? sourceRequisitions[0]?.approvalChain || []
        : [];
    const sourceVcStep = intakeSourceChain.find(
      (step) => step.role === ROLES.VC && step.type === "approval"
    );
    if (
      (isProcurementIntakeConsolidation || isMarketSurveyedProcurementConsolidation) &&
      !sourceVcStep
    ) {
      return NextResponse.json(
        {
          message: "The selected Procurement intake requisitions do not have a valid VC approval step.",
        },
        { status: 400 }
      );
    }

    const procurementReviewStep =
      isProcurementIntakeConsolidation || isMarketSurveyedProcurementConsolidation
        ? {
            role: ROLES.PROCUREMENT,
            approver: auth.sub,
            type: "procurement_review",
          }
        : null;

    const outcomeFields = isProcurementIntakeConsolidation
      ? {
          status: REQUISITION_STATUS.PENDING,
          currentStepIndex: 0,
          approvalChain: [
            procurementReviewStep,
            {
              role: ROLES.VC,
              approver: sourceVcStep.approver,
              type: "approval",
            },
          ],
          procurementStatus: "review",
          procurementOfficer: auth.sub,
          procurementAssignedBy: auth.sub,
          procurementReceivedAt: now,
        }
      : isMarketSurveyedProcurementConsolidation
      ? {
          status: REQUISITION_STATUS.PENDING,
          currentStepIndex: 0,
          approvalChain: [
            procurementReviewStep,
            {
              role: ROLES.VC,
              approver: sourceVcStep.approver,
              type: "approval",
            },
          ],
          procurementStatus: "director_review",
          procurementOfficer: auth.sub,
          procurementAssignedBy: auth.sub,
          procurementReceivedAt: now,
          procurementReviewStartedAt: now,
        }
      : isAcceptedProcurementConsolidation
      ? {
          status: REQUISITION_STATUS.APPROVED,
          requisitionNumber: await generateRequisitionNumber(),
          submittedAt: now,
          finalApprovalAt: now,
          decidedAt: now,
          currentStepIndex: 0,
          approvalChain: [],
          procurementStatus: "accepted",
          procurementOfficer: auth.sub,
          procurementReceivedAt: now,
        }
      : auth.role === ROLES.PROCUREMENT
      ? {
          status: REQUISITION_STATUS.DRAFT,
          currentStepIndex: 0,
          approvalChain: postApprovalConsolidationChain,
          procurementStatus: undefined,
        }
      : isFinalizedOutcome
      ? {
          status: REQUISITION_STATUS.APPROVED,
          requisitionNumber: await generateRequisitionNumber(),
          submittedAt: now,
          finalApprovalAt: now,
          decidedAt: now,
          currentStepIndex: 0,
          approvalChain: [],
          procurementStatus: "accepted",
          procurementOfficer: procurementOfficer._id,
          procurementReceivedAt: now,
        }
      : {
          status: REQUISITION_STATUS.DRAFT,
          currentStepIndex: 0,
          approvalChain: [],
        };

    const originalInitiators = await collectOriginalInitiators(sourceRequisitions);

    /*
     * --------------------------------------------------
     * CREATE CONSOLIDATED REQUISITION
     * --------------------------------------------------
     */
    const consolidated = await Requisition.create({
      requester: auth.sub,
      requesterRole: auth.role,
      isConsolidated: true,
      sourceRequisitions: sourceRequisitions.map((r) => r._id),
      consolidatedBy: auth.sub,
      consolidatedByRole: auth.role,
      originalInitiators,
      requestingUnits,
      // If multiple units, store "N/A" at top level – keep as string for compatibility.
      collegeId: commonCollegeId,
      facultyId: commonFacultyId,
      department: singleUnit?.department || "N/A",
      category: sourceCategory, // Use the validated source category.
      purpose: purpose.trim(),
      urgency: urgency.trim().toLowerCase(),
      items: consolidatedItems,
      estimatedCost,
      awaitingRequesterAction: false,
      ...outcomeFields,
    });

    /*
     * --------------------------------------------------
     * LINK SOURCE REQUISITIONS (with concurrency safety)
     * --------------------------------------------------
     *
     * We use updateMany with an extra condition to ensure that
     * no source has been consolidated by another simultaneous request.
     */
    const consolidationDate = new Date();

    const updateResult = await Requisition.updateMany(
      {
        _id: { $in: sourceRequisitions.map((r) => r._id) },
        // Only update if this source is not already nested under another
        // representative. A consolidated representative created at the top
        // level has no consolidatedInto yet and can therefore become a child
        // of the new representative. Once nested, it cannot be reused again.
        consolidatedInto: { $exists: false },
      },
      {
        $set: {
          consolidatedInto: consolidated._id,
          consolidatedAt: consolidationDate,
        },
      }
    );

    // If not all sources were updated, rollback the new requisition and error.
    if (updateResult.modifiedCount !== sourceRequisitions.length) {
      // Delete the newly created consolidated requisition.
      await Requisition.deleteOne({ _id: consolidated._id });
      return NextResponse.json(
        {
          message:
            "One or more requisitions were consolidated by another request. Please try again.",
        },
        { status: 409 } // Conflict
      );
    }

    /*
     * --------------------------------------------------
     * ADVANCE SOURCE WORKFLOW THROUGH CONSOLIDATION
     * --------------------------------------------------
     *
     * For Dean/Provost/VC consolidation, the consolidation itself
     * is the current authority's approval action. The source
     * requisitions therefore move forward immediately instead of
     * remaining stuck at the same approval step.
     *
     * The original requisitions remain intact and trackable; the
     * consolidated requisition becomes their representative workflow
     * record.
     */
    if (isPreApprovalConsolidator) {
      const sourceApprovalRecords = [];
      const sourceUpdates = [];
      let sourceUpdateError = null;

      for (const source of sourceRequisitions) {
        const currentSourceStep =
          source.approvalChain?.[source.currentStepIndex];

        if (
          !currentSourceStep ||
          currentSourceStep.type !== "approval" ||
          String(currentSourceStep.approver) !== String(auth.sub)
        ) {
          sourceUpdateError = new Error(
            `Requisition ${source.requisitionNumber || source._id} is no longer awaiting this user's approval.`
          );
          break;
        }

        sourceApprovalRecords.push({
          requisition: source._id,
          stepIndex: source.currentStepIndex,
          role: currentSourceStep.role,
          approver: auth.sub,
          action: "approve",
          comment: `Approved through consolidation ${consolidated.requisitionNumber || consolidated._id}.`,
        });

        const nextIndex = source.currentStepIndex + 1;
        const nextStep = source.approvalChain?.[nextIndex];

        if (auth.role === ROLES.VC || currentSourceStep.role === ROLES.VC) {
          sourceUpdates.push({
            updateOne: {
              filter: { _id: source._id },
              update: {
                $set: {
                  status: REQUISITION_STATUS.APPROVED,
                  finalApprovalAt: consolidationDate,
                  decidedAt: consolidationDate,
                  awaitingRequesterAction: false,
                  currentStepIndex: source.currentStepIndex,
                  procurementStatus: "accepted",
                  procurementReceivedAt: consolidationDate,
                },
              },
            },
          });
        } else if (nextStep) {
          sourceUpdates.push({
            updateOne: {
              filter: { _id: source._id },
              update: {
                $set: {
                  currentStepIndex: nextIndex,
                  status: REQUISITION_STATUS.PENDING,
                  awaitingRequesterAction: false,
                },
              },
            },
          });
        }
      }

      if (sourceUpdateError) {
        await Requisition.updateMany(
          { _id: { $in: sourceRequisitions.map((r) => r._id) } },
          { $unset: { consolidatedInto: "", consolidatedAt: "" } }
        );
        await Requisition.deleteOne({ _id: consolidated._id });
        return NextResponse.json(
          { message: sourceUpdateError.message },
          { status: 409 }
        );
      }

      if (sourceUpdates.length) {
        await Requisition.bulkWrite(sourceUpdates);
      }
      if (sourceApprovalRecords.length) {
        await Approval.insertMany(sourceApprovalRecords);
      }

      // The direct sources above are advanced by this endpoint. If any of
      // those sources is itself consolidated, recursively mirror the same
      // approval into its descendants so nested consolidation never leaves
      // the original HOD requisitions stuck at the old step.
      if (sourceRequisitions.some((source) => source.isConsolidated)) {
        const approvedStep = sourceRequisitions[0]?.approvalChain?.[
          sourceRequisitions[0]?.currentStepIndex
        ];

        if (approvedStep) {
          await syncConsolidatedSourcesAfterApproval({
            representative: consolidated,
            approvedStep,
            approverId: auth.sub,
            comment: `Approved through consolidation ${consolidated.requisitionNumber || consolidated._id}.`,
            recordApproval: true,
          });
        }
      }
    }

    /*
     * --------------------------------------------------
     * AUDIT LOG
     * --------------------------------------------------
     */
    await AuditLog.create({
      actor: auth.sub,
      action: "requisition.consolidated_create",
      entityType: "Requisition",
      entityId: consolidated._id,
      details: {
        requesterRole: auth.role,
        consolidatedByRole: auth.role,
        originalInitiators: originalInitiators.map((entry) => ({
          requester: String(entry.requester),
          role: entry.role,
          requisition: String(entry.requisition),
        })),
        outcomeStatus: consolidated.status,
        sourceRequisitions: sourceRequisitions.map((r) => String(r._id)),
        requestingUnits,
        itemCount: consolidatedItems.length,
        estimatedCost,
      },
    });

    return NextResponse.json(
      { requisition: consolidated },
      { status: 201 }
    );
  } catch (error) {
    console.error("Consolidated requisition error:", error);
    return NextResponse.json(
      { message: error.message || "Failed to create consolidated requisition." },
      { status: 500 }
    );
  }
  }
