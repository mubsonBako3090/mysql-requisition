import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";

import User from "@/models/User";
import Requisition from "@/models/Requisition";

import {
  submitRequisitionSchema,
} from "@/lib/validators/requisition";

import {
  submitRequisition,
} from "@/services/requisitionService";
import { createNotifications } from "@/lib/notifications";

function getAuth() {
  const token =
    cookies().get("token")?.value;

  return token
    ? verifyToken(token)
    : null;
}

export async function POST(
  request,
  { params }
) {
  const auth = getAuth();

  if (!auth) {
    return NextResponse.json(
      {
        message: "Unauthorized",
      },
      {
        status: 401,
      }
    );
  }

  try {
    await connectDB();

    /*
     * Load the requisition by ID first.
     *
     * Consolidated representatives preserve the original requester
     * for traceability, while the user submitting the representative
     * may be the person who performed the consolidation. The service
     * performs the actual authorization check.
     */
    const existing =
      await Requisition.findById(
        params.id
      ).lean();

    if (!existing) {
      return NextResponse.json(
        {
          message:
            "Requisition not found.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * Validate the completed requisition.
     */
    const validationItems =
  (existing.items || []).map((item) => ({
    ...item,
    sourceRequisitionId:
      item.sourceRequisitionId
        ? String(item.sourceRequisitionId)
        : item.sourceRequisitionId,
  }));

const {
  error,
} =
  submitRequisitionSchema.validate({
    category:
      existing.category,

    purpose:
      existing.purpose,

    urgency:
      existing.urgency,

    items:
      validationItems,
  });

    if (error) {
      return NextResponse.json(
        {
          message:
            `Requisition is incomplete: ${error.details[0].message}`,
        },
        {
          status: 400,
        }
      );
    }

    const requesterUser =
      await User.findById(
        auth.sub
      ).lean();

    if (!requesterUser) {
      return NextResponse.json(
        {
          message:
            "Requester account not found.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * Pass the complete authenticated user
     * information to the service.
     */
    const requisition =
      await submitRequisition({
        requisitionId:
          params.id,

        requesterUser: {
          id: auth.sub,

          fullName:
            requesterUser.fullName,

          email:
            requesterUser.email,

          role:
            requesterUser.role,

          collegeId:
            requesterUser.collegeId,

          facultyId:
            requesterUser.facultyId,

          department:
            requesterUser.department,
        },
      });

    const nextStep = requisition?.approvalChain?.[requisition?.currentStepIndex || 0];
    if (nextStep?.approver) {
      await createNotifications({
        recipientIds: [nextStep.approver],
        title: "Requisition awaiting your review",
        message: `${requisition.requisitionNumber || "A requisition"} has been submitted and is awaiting your decision.`,
        type: "info",
        requisition,
      });
    }

    return NextResponse.json({
      requisition,
    });
  } catch (err) {
    console.error(err);

    return NextResponse.json(
      {
        message:
          err.message ||
          "Submission failed.",
      },
      {
        status: 500,
      }
    );
  }
        }
