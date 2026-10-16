import { cookies } from "next/headers";

import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";

import User from "@/models/User";
import { PROCUREMENT_POSITION_LABELS } from "@/constants/procurement";

export async function getCurrentUser() {
  const token = cookies().get("token")?.value;

  if (!token) {
    console.log("GET CURRENT USER: No token found");
    return null;
  }

  const payload = verifyToken(token);

  if (!payload) {
    console.log("GET CURRENT USER: Token verification failed");
    return null;
  }

  console.log("GET CURRENT USER: JWT payload:", {
    sub: payload.sub,
    role: payload.role,
  });

  await connectDB();

  const user = await User.findById(payload.sub)
    .select("-passwordHash -passwordResetToken")
    .lean();

  if (!user) {
    console.log(
      "GET CURRENT USER: User not found for ID:",
      payload.sub
    );
    return null;
  }

  console.log("GET CURRENT USER: User found:", {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    accountStatus: user.accountStatus,
  });

  if (user.accountStatus !== "active") {
    console.log(
      "GET CURRENT USER: Account is not active:",
      user.accountStatus
    );
    return null;
  }

  return {
    id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    procurementPosition: user.procurementPosition,
    procurementPositionLabel:
      PROCUREMENT_POSITION_LABELS[user.procurementPosition] ||
      user.procurementPosition,
    collegeId: user.collegeId,
    facultyId: user.facultyId,
    department: user.department,
  };
}