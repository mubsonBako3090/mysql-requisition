import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";

import {
  rejectActionSchema,
} from "@/lib/validators/requisition";

import {
  rejectStep,
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
      rejectActionSchema.validate(
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
      await rejectStep({
        requisitionId:
          params.id,

        approverUser: {
          id: auth.sub,
        },

        comment:
          value.comment,

        isFinal:
          value.isFinal,
      });

    const isFinalRejection = requisition?.status === "rejected";
    await createNotifications({
      recipientIds: getRequisitionInitiatorIds(requisition),
      title: isFinalRejection ? "Requisition rejected" : "Requisition returned for revision",
      message: isFinalRejection
        ? `${requisition.requisitionNumber || "Your requisition"} was rejected. Review the decision comments for details.`
        : `${requisition.requisitionNumber || "Your requisition"} was returned for revision. Review the comments and make the required changes.`,
      type: isFinalRejection ? "error" : "warning",
      requisition,
    });

    return NextResponse.json({
      requisition,
    });
  } catch (err) {
    console.error(err);

    return NextResponse.json(
      {
        message:
          err.message ||
          "Rejection failed.",
      },
      {
        status: 400,
      }
    );
  }
}
