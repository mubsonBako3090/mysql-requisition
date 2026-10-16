import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { ROLES } from "@/constants/roles";
import { assignProcurementOfficer } from "@/services/approvalService";
import { createNotifications } from "@/lib/notifications";

function getAuth() {
  const token = cookies().get("token")?.value;
  return token ? verifyToken(token) : null;
}

export async function POST(request, { params }) {
  const auth = getAuth();
  if (!auth) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (auth.role !== ROLES.PROCUREMENT) {
    return NextResponse.json({ message: "Only Procurement staff can assign requisitions." }, { status: 403 });
  }

  try {
    const body = await request.json();
    await connectDB();

    const requisition = await assignProcurementOfficer({
      requisitionId: params.id,
      assigningUser: { id: auth.sub },
      procurementOfficerId: body.procurementOfficerId,
      note: body.note,
    });

    const assignedId = requisition?.procurementOfficer || requisition?.procurementAssignedTo || body.procurementOfficerId;
    await createNotifications({
      recipientIds: [assignedId],
      title: "Requisition assigned for market survey",
      message: `${requisition?.requisitionNumber || "A requisition"} has been assigned to you for Procurement review.`,
      type: "info",
      requisition,
    });

    return NextResponse.json({ requisition });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { message: err.message || "Failed to assign Procurement officer." },
      { status: 400 }
    );
  }
}
