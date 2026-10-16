import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { ROLES } from "@/constants/roles";
import { createNotifications } from "@/lib/notifications";
import {
  updateProcurementReview,
  submitProcurementForDirectorReview,
  submitProcurementToVc,
} from "@/services/approvalService";

function getAuth() {
  const token = cookies().get("token")?.value;
  return token ? verifyToken(token) : null;
}

export async function PATCH(request, { params }) {
  const auth = getAuth();

  if (!auth) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (auth.role !== ROLES.PROCUREMENT) {
    return NextResponse.json({ message: "Only Procurement Officers can perform market-survey review." }, { status: 403 });
  }

  try {
    const body = await request.json();
    await connectDB();

    const requisition = await updateProcurementReview({
      requisitionId: params.id,
      procurementUser: { id: auth.sub, procurementPosition: auth.procurementPosition },
      items: body.items,
      notes: body.notes,
    });

    return NextResponse.json({ requisition });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { message: err.message || "Procurement review update failed." },
      { status: 400 }
    );
  }
}

export async function POST(request, { params }) {
  const auth = getAuth();

  if (!auth) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (auth.role !== ROLES.PROCUREMENT) {
    return NextResponse.json({ message: "Only Procurement staff can submit a requisition from the market-survey stage." }, { status: 403 });
  }

  try {
    const body = await request.json();
    await connectDB();

    const requisition = auth.procurementPosition === "director"
      ? await submitProcurementToVc({
          requisitionId: params.id,
          procurementUser: { id: auth.sub, procurementPosition: auth.procurementPosition },
          comment: body.comment,
        })
      : await submitProcurementForDirectorReview({
          requisitionId: params.id,
          procurementUser: { id: auth.sub, procurementPosition: auth.procurementPosition },
          comment: body.comment,
        });

    const nextStep = (requisition?.approvalChain || []).find((step) =>
      auth.procurementPosition === "director"
        ? step?.role === "vc" && step?.type === "approval"
        : step?.role === "procurement" && step?.type === "procurement_review" && step?.approver && String(step.approver) !== String(auth.sub)
    );
    if (nextStep?.approver) {
      await createNotifications({
        recipientIds: [nextStep.approver],
        title: auth.procurementPosition === "director" ? "Requisition awaiting VC decision" : "Market survey ready for Director review",
        message: auth.procurementPosition === "director"
          ? `${requisition?.requisitionNumber || "A requisition"} has been submitted to the VC for a decision.`
          : `${requisition?.requisitionNumber || "A requisition"} has completed market survey and is ready for Director review.`,
        type: "info",
        requisition,
      });
    }

    return NextResponse.json({ requisition });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { message: err.message || "Failed to submit requisition to VC." },
      { status: 400 }
    );
  }
}
