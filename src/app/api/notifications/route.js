import { isValidObjectId } from "@/lib/orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import Notification from "@/models/Notification";

function getAuth() {
  const token = cookies().get("token")?.value;
  return token ? verifyToken(token) : null;
}

export async function GET(request) {
  const auth = getAuth();
  if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  await connectDB();
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 50), 1), 100);
  const [notifications, unreadCount] = await Promise.all([
    Notification.find({ recipient: auth.sub })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("title message type requisition requisitionNumber href readAt createdAt")
      .lean(),
    Notification.countDocuments({ recipient: auth.sub, readAt: null }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH(request) {
  const auth = getAuth();
  if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    await connectDB();

    if (body?.all === true) {
      const result = await Notification.updateMany(
        { recipient: auth.sub, readAt: null },
        { $set: { readAt: new Date() } }
      );
      return NextResponse.json({ success: true, modifiedCount: result.modifiedCount });
    }

    if (!body?.id || !isValidObjectId(body.id)) {
      return NextResponse.json({ message: "A valid notification ID is required." }, { status: 400 });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: body.id, recipient: auth.sub },
      { $set: { readAt: new Date() } },
      { new: true }
    ).lean();

    if (!notification) return NextResponse.json({ message: "Notification not found." }, { status: 404 });
    return NextResponse.json({ success: true, notification });
  } catch (error) {
    console.error("Notification update failed:", error);
    return NextResponse.json({ message: "Unable to update notification." }, { status: 500 });
  }
}
