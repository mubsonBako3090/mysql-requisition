import { isValidObjectId } from "@/lib/orm";
import Notification from "@/models/Notification";

function toId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toHexString === "function") return value.toHexString();
  if (value._id) return String(value._id);
  if (value.id) return String(value.id);
  return String(value);
}

/**
 * Store in-app notifications without allowing notification failures to
 * interrupt the underlying approval/requisition workflow.
 */
export async function createNotifications({
  recipientIds = [],
  title,
  message,
  type = "info",
  requisition,
}) {
  const requisitionId = toId(requisition?._id || requisition?.id);
  const ids = [...new Set(recipientIds.map(toId).filter(Boolean))]
    .filter((id) => isValidObjectId(id));

  if (!ids.length || !title || !message) return;

  try {
    await Notification.insertMany(
      ids.map((recipient) => ({
        recipient,
        title,
        message,
        type,
        ...(requisitionId && isValidObjectId(requisitionId)
          ? { requisition: requisitionId }
          : {}),
        requisitionNumber: requisition?.requisitionNumber || "",
        href: requisitionId && isValidObjectId(requisitionId)
          ? `/requisitions/${requisitionId}`
          : "/notifications",
      })),
      { ordered: false }
    );
  } catch (error) {
    // Notifications are supplementary; do not fail a completed workflow action.
    console.error("Unable to create in-app notification:", error?.message || error);
  }
}

export function getRequisitionInitiatorIds(requisition) {
  const ids = [requisition?.requester];
  for (const initiator of requisition?.originalInitiators || []) {
    ids.push(initiator?.requester || initiator?.user || initiator);
  }
  return [...new Set(ids.map(toId).filter(Boolean))];
}
