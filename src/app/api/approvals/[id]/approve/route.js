import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";

import {
  approvalActionSchema,
} from "@/lib/validators/requisition";

import {
  approveStep,
} from "@/services/approvalService";
import { createNotifications, getRequisitionInitiatorIds } from "@/lib/notifications";

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
    const body =
      await request.json();

    const {
      error,
      value,
    } =
      approvalActionSchema.validate(
        body
      );

    if (error) {
      return NextResponse.json(
        {
          message:
            error.details[0]
              .message,
        },
        {
          status: 400,
        }
      );
    }

    await connectDB();

    const requisition =
      await approveStep({
        requisitionId:
          params.id,

        approverUser: {
          id: auth.sub,
        },

        comment:
          value.comment,
      });

    if (requisition?.status === "approved") {
      const initiators = getRequisitionInitiatorIds(requisition);
      await createNotifications({
        recipientIds: initiators,
        title: "Requisition approved",
        message: `${requisition.requisitionNumber || "Your requisition"} has received final approval.`,
        type: "success",
        requisition,
      });
      if (requisition.procurementOfficer) {
        await createNotifications({
          recipientIds: [requisition.procurementOfficer],
          title: "Requisition ready for Procurement",
          message: `${requisition.requisitionNumber || "A requisition"} has been approved and is ready for the next Procurement stage.`,
          type: "info",
          requisition,
        });
      }
    } else {
      const nextStep = requisition?.approvalChain?.[requisition?.currentStepIndex];
      if (nextStep?.approver) {
        await createNotifications({
          recipientIds: [nextStep.approver],
          title: "Requisition awaiting your review",
          message: `${requisition.requisitionNumber || "A requisition"} has moved to your approval queue.`,
          type: "info",
          requisition,
        });
      }
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
          "Approval failed.",
      },
      {
        status: 400,
      }
    );
  }
        }
