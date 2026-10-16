import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import User from "@/models/User";
import { ROLES } from "@/constants/roles";
import {
  PROCUREMENT_MARKET_SURVEY_POSITIONS,
  PROCUREMENT_POSITION_LABELS,
} from "@/constants/procurement";

function getAuth() {
  const token = cookies().get("token")?.value;
  return token ? verifyToken(token) : null;
}

export async function GET() {
  const auth = getAuth();
  if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  if (auth.role !== ROLES.PROCUREMENT) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const staff = await User.find({
    role: ROLES.PROCUREMENT,
    accountStatus: "active",
    procurementPosition: { $in: PROCUREMENT_MARKET_SURVEY_POSITIONS },
  })
    .select("fullName email procurementPosition")
    .sort({ fullName: 1 })
    .lean();

  return NextResponse.json({
    staff: staff.map((member) => ({
      ...member,
      _id: String(member._id),
      positionLabel: PROCUREMENT_POSITION_LABELS[member.procurementPosition] || member.procurementPosition,
    })),
  });
}
