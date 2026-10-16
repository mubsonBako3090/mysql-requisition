"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import axios from "axios";
import toast from "react-hot-toast";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import RequisitionItemsTable from "@/components/requisitions/RequisitionItemsTable";
import RequisitionStatusTimeline from "@/components/requisitions/RequisitionStatusTimeline";
import RequisitionCommentThread from "@/components/requisitions/RequisitionCommentThread";
import ProcurementReviewPanel from "@/components/requisitions/ProcurementReviewPanel";
import ProcurementAssignmentPanel from "@/components/requisitions/ProcurementAssignmentPanel";
import ProcurementProcessingPanel from "@/components/requisitions/ProcurementProcessingPanel";
import { formatNaira } from "@/utils/formatNaira";
import { formatDateTime } from "@/utils/formatDate";
import styles from "./page.module.css";

function isProcurementReview(requisition) {
  const step = requisition?.approvalChain?.[requisition.currentStepIndex];
  return step?.role === "procurement" && step?.type === "procurement_review";
}

function isProcurementProcessing(requisition) {
  const step = requisition?.approvalChain?.[requisition.currentStepIndex];
  return step?.role === "procurement" && step?.type === "processing";
}

function isVcReview(requisition) {
  const step = requisition?.approvalChain?.[requisition.currentStepIndex];
  return step?.role === "vc" && step?.type === "approval" && requisition?.procurementStatus === "submitted_to_vc";
}

export default function ApprovalActionPage() {
  const { id } = useParams();
  const router = useRouter();
  const [requisition, setRequisition] = useState(null);
  const [comment, setComment] = useState("");
  const [busyAction, setBusyAction] = useState(null); // "approve" | "return" | "reject" | null
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);

  /*
   * Handling specific ITEMS separately (return/reject) instead
   * of deciding on the whole requisition at once — works for
   * both plain and consolidated requisitions.
   */
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [handlingComment, setHandlingComment] = useState("");
  const [handlingBusy, setHandlingBusy] = useState(null);
  const [showItemPanel, setShowItemPanel] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`/api/requisitions/${id}`);
      setRequisition(data.requisition);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load requisition.");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleApprove() {
    setBusyAction("approve");
    try {
      await axios.post(`/api/approvals/${id}/approve`, { comment });
      toast.success("Requisition approved.");
      router.push("/approvals");
    } catch (err) {
      toast.error(err.response?.data?.message || "Approval failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReturn() {
    if (!comment.trim()) {
      toast.error("Add a comment explaining what needs clarification.");
      return;
    }
    setBusyAction("return");
    try {
      await axios.post(`/api/approvals/${id}/return`, { comment });
      toast.success("Requisition returned for clarification.");
      router.push("/approvals");
    } catch (err) {
      toast.error(err.response?.data?.message || "Return failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReject(isFinal) {
    if (!comment.trim()) {
      toast.error("A comment is required to reject a requisition.");
      return;
    }
    setBusyAction("reject");
    try {
      await axios.post(`/api/approvals/${id}/reject`, { comment, isFinal });
      toast.success(isFinal ? "Requisition rejected." : "Requisition rejected and returned to requester.");
      router.push("/approvals");
    } catch (err) {
      toast.error(err.response?.data?.message || "Rejection failed.");
    } finally {
      setBusyAction(null);
      setShowRejectConfirm(false);
    }
  }

  function toggleItemSelect(index) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  async function handlePartial(action) {
    if (selectedItems.size === 0) {
      toast.error("Select at least one item first.");
      return;
    }
    if (!handlingComment.trim()) {
      toast.error("A comment is required.");
      return;
    }
    setHandlingBusy(action);
    try {
      const { data } = await axios.post(`/api/approvals/${id}/partial`, {
        itemIndexes: [...selectedItems],
        action,
        comment: handlingComment.trim(),
      });

      if (data.closed) {
        toast.success(
          "Sent back — no items remain, so this requisition was closed."
        );
        router.push("/approvals");
        return;
      }

      toast.success(
        action === "return"
          ? "Those items were sent back to the requester on their own."
          : "Those items were rejected on their own."
      );
      await load();
      setSelectedItems(new Set());
      setHandlingComment("");
      setShowItemPanel(false);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to handle those items separately.");
    } finally {
      setHandlingBusy(null);
    }
  }

  if (!requisition) return <p>Loading…</p>;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>{requisition.requisitionNumber}</h1>
          <Badge status={requisition.status} />
        </div>
      </div>

      {isProcurementReview(requisition) && (
        <ProcurementAssignmentPanel
          requisition={requisition}
          onUpdated={(updated) => setRequisition(updated)}
        />
      )}

      {isProcurementReview(requisition) && (
        <ProcurementReviewPanel
          requisition={requisition}
          onUpdated={(updated) => setRequisition(updated)}
        />
      )}

      {isProcurementProcessing(requisition) && (
        <ProcurementProcessingPanel
          requisition={requisition}
          onUpdated={(updated) => setRequisition(updated)}
        />
      )}

      {isVcReview(requisition) && (
        <section className={styles.section}>
          <div className={styles.itemsHeader}>
            <div>
              <h4 className={styles.sectionTitle}>Procurement Market Survey</h4>
              <p className={styles.hint}>
                These are the market-surveyed prices submitted by Procurement for your final approval.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.open(`/api/requisitions/${requisition._id}/pdf?type=boq`, "_blank")}
            >
              <i className="bi bi-file-earmark-pdf" /> View BOQ
            </Button>
          </div>
          <div className={styles.costDisplay}>
            {formatNaira(requisition.estimatedCost)}
          </div>

          <div className={styles.section} style={{ marginTop: 16 }}>
            <h4 className={styles.sectionTitle}>Market-Surveyed Item Prices</h4>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8 }}>Item</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Qty</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Requested Unit</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Market Unit</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Market Total</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Procurement Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(requisition.items || []).map((item, index) => {
                    const requested = Number(item.requestedUnitCost ?? item.unitCost ?? 0);
                    const market = Number(item.procurementUnitCost ?? item.unitCost ?? 0);
                    const quantity = Number(item.quantity || 0);
                    return (
                      <tr key={`${item.name}-${index}`}>
                        <td style={{ padding: 8 }}>{item.name}</td>
                        <td style={{ textAlign: "right", padding: 8 }}>{quantity}</td>
                        <td style={{ textAlign: "right", padding: 8 }}>{formatNaira(requested)}</td>
                        <td style={{ textAlign: "right", padding: 8 }}>{formatNaira(market)}</td>
                        <td style={{ textAlign: "right", padding: 8 }}>{formatNaira(quantity * market)}</td>
                        <td style={{ padding: 8 }}>{item.procurementNote || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {requisition.procurementNotes && (
              <div style={{ marginTop: 12 }}>
                <strong>Procurement Market Survey Notes</strong>
                <p className={styles.hint}>{requisition.procurementNotes}</p>
              </div>
            )}
          </div>
        </section>
      )}

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Details</h4>
            <dl className={styles.dl}>
              <dt>Requester</dt>
              <dd>{requisition.requester?.fullName}</dd>
              <dt>Department</dt>
              <dd>{requisition.department}</dd>
              <dt>Category</dt>
              <dd>{requisition.category}</dd>
              <dt>Urgency</dt>
              <dd>{requisition.urgency}</dd>
              <dt>Purpose</dt>
              <dd>{requisition.purpose}</dd>
              <dt>Submitted</dt>
              <dd>{formatDateTime(requisition.submittedAt)}</dd>
            </dl>
          </section>

          <section className={styles.section}>
            <div className={styles.itemsHeader}>
              <h4 className={styles.sectionTitle}>Items</h4>
              {selectedItems.size > 0 && (
                <span className={styles.selectionCount}>
                  {selectedItems.size} selected
                </span>
              )}
            </div>

            <p className={styles.hint}>
              Check any items you want to send back or reject on their own, instead of deciding on
              the whole requisition.
            </p>

            <RequisitionItemsTable
              items={requisition.items}
              requestingUnits={requisition.requestingUnits}
              readOnly
              selectable
              selectedIndexes={selectedItems}
              onToggleSelect={(index) => {
                toggleItemSelect(index);
                setShowItemPanel(true);
              }}
            />

            {showItemPanel && selectedItems.size > 0 && (
              <div className={styles.handlePanel}>
                <p className={styles.handlePanelHint}>
                  Send the selected items back to their requester on their own, or reject them —
                  the rest of the requisition stays as is either way.
                </p>

                <textarea
                  className={styles.handlePanelTextarea}
                  rows={2}
                  placeholder="Comment (required)…"
                  value={handlingComment}
                  onChange={(e) => setHandlingComment(e.target.value)}
                />

                <div className={styles.handlePanelActions}>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handlePartial("return")}
                    loading={handlingBusy === "return"}
                  >
                    Return Selected Items
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => handlePartial("reject")}
                    loading={handlingBusy === "reject"}
                  >
                    Reject Selected Items
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSelectedItems(new Set());
                      setHandlingComment("");
                      setShowItemPanel(false);
                    }}
                  >
                    Clear Selection
                  </Button>
                </div>
              </div>
            )}
          </section>

          {requisition.attachments?.length > 0 && (
            <section className={styles.section}>
              <h4 className={styles.sectionTitle}>Supporting Documents</h4>
              <ul className={styles.fileList}>
                {requisition.attachments.map((a) => (
                  <li key={a.publicId}>
                    <a href={a.url} target="_blank" rel="noreferrer">
                      <i className="bi bi-file-earmark" /> {a.fileName}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <RequisitionCommentThread
            requisitionId={id}
            comments={requisition.comments}
            onCommentAdded={(comments) => setRequisition((r) => ({ ...r, comments }))}
          />

          {!isProcurementReview(requisition) && (
            <section className={styles.section}>
              <h4 className={styles.sectionTitle}>Your Decision</h4>
              <textarea
                className={styles.decisionTextarea}
                rows={3}
                placeholder="Add a comment (required for return/reject, optional for approve)…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />

              {!showRejectConfirm ? (
                <div className={styles.decisionActions}>
                  <Button onClick={handleApprove} loading={busyAction === "approve"}>
                    <i className="bi bi-check-lg" /> Approve
                  </Button>
                  <Button variant="secondary" onClick={handleReturn} loading={busyAction === "return"}>
                    <i className="bi bi-arrow-return-left" /> Return for Clarification
                  </Button>
                  <Button variant="danger" onClick={() => setShowRejectConfirm(true)}>
                    <i className="bi bi-x-lg" /> Reject
                  </Button>
                </div>
              ) : (
                <div className={styles.rejectConfirm}>
                  <p className={styles.rejectPrompt}>Should the requester be allowed to edit and resubmit?</p>
                  <div className={styles.decisionActions}>
                    <Button variant="secondary" onClick={() => handleReject(false)} loading={busyAction === "reject"}>
                      Reject — Allow Resubmission
                    </Button>
                    <Button variant="danger" onClick={() => handleReject(true)} loading={busyAction === "reject"}>
                      Reject — Final
                    </Button>
                    <Button variant="ghost" onClick={() => setShowRejectConfirm(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <div className={styles.sideCol}>
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Approval Progress</h4>
            <RequisitionStatusTimeline
              requisition={requisition}
            />
          </section>

          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Estimated Cost</h4>
            <div className={styles.costDisplay}>{formatNaira(requisition.estimatedCost)}</div>
            {requisition.requiresGovernorApproval && (
              <p className={styles.escalationNote}>
                <i className="bi bi-exclamation-triangle" /> Exceeds ₦10,000,000 — requires Governor approval.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
