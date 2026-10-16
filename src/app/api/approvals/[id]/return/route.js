import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";

import {
  approvalActionSchema,
} from "@/lib/validators/requisition";

import {
  returnStep,
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

    if (
      !value.comment ||
      !value.comment.trim()
    ) {
      return NextResponse.json(
        {
          message:
            "A comment is required when returning for clarification.",
        },
        {
          status: 400,
        }
      );
    }

    await connectDB();

    const requisition =
      await returnStep({
        requisitionId:
          params.id,

        approverUser: {
          id: auth.sub,
        },

        comment:
          value.comment.trim(),
      });

    if (requisition?.awaitingRequesterAction) {
      await createNotifications({
        recipientIds: getRequisitionInitiatorIds(requisition),
        title: "Requisition returned for clarification",
        message: `${requisition.requisitionNumber || "Your requisition"} was returned. Please review the comments and make the required changes.`,
        type: "warning",
        requisition,
      });
    } else {
      const previousStep = requisition?.approvalChain?.[requisition?.currentStepIndex];
      if (previousStep?.approver) {
        await createNotifications({
          recipientIds: [previousStep.approver],
          title: "Requisition returned to your queue",
          message: `${requisition.requisitionNumber || "A requisition"} was returned to your approval step for follow-up.`,
          type: "warning",
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
          "Return failed.",
      },
      {
        status: 400,
      }
    );
  }
                             }
