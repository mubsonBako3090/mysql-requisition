"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";
import Button from "@/components/ui/Button";
import styles from "./dashboard-grid.module.css";

export default function VCDashboard({ user }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    axios.get("/api/dashboard").then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  const cards = [
    ["Awaiting My Approval", stats?.pendingMyStep, "bi-hourglass-split", "pending", "/approvals", "All requisitions currently at the VC approval step."],
    ["Normal Approvals", stats?.normalAwaitingApproval, "bi-check2-square", "pending", "/approvals", "Institutional requisitions awaiting your normal approval decision."],
    ["Procurement Submissions", stats?.procurementAwaitingVc, "bi-briefcase", "pending", "/approvals", "Market-surveyed or Procurement-consolidated requisitions submitted for VC approval."],
    ["Approved by Me", stats?.approvedByMe, "bi-check-circle", "approved", "/approvals", "Approval decisions you have made."],
    ["Returned by Me", stats?.returnedByMe, "bi-arrow-repeat", "", "/approvals", "Requisitions you returned for clarification or correction."],
    ["Rejected by Me", stats?.rejectedByMe, "bi-x-circle", "rejected", "/approvals", "Requisitions you rejected."],
  ];

  return (
    <div className={styles.wrapper}>
      <div>
        <h1 className={styles.heading}>Welcome, {user.fullName.split(" ")[0]}</h1>
        <p className={styles.subheading}>Vice Chancellor — Final Institutional Approval</p>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>VC Decision Desk</h2>
            <p className={styles.sectionSubtitle}>
              Focus on final institutional approvals, including requisitions submitted by Procurement after market survey.
            </p>
          </div>
        </div>

        <div className={styles.statGrid}>
          {cards.map(([label, value, icon, tone, href, description]) => (
            <Link href={href} className={styles.queueCard} key={label}>
              <div className={styles.queueIcon}><i className={`bi ${icon}`} /></div>
              <div className={styles.queueBody}>
                <div className={styles.queueLabel}>{label}</div>
                <div className={`${styles.queueValue} ${tone === "pending" ? styles.queueValuePending : tone === "approved" ? styles.queueValueApproved : tone === "rejected" ? styles.queueValueRejected : ""}`}>
                  {value ?? 0}
                </div>
                <div className={styles.queueDescription}>{description}</div>
              </div>
              <i className={`bi bi-chevron-right ${styles.queueArrow}`} />
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Decision History</h2>
            <p className={styles.sectionSubtitle}>Your complete approval activity across the system.</p>
          </div>
        </div>
        <div className={styles.statGrid}>
          <div className={styles.queueCard}>
            <div className={styles.queueIcon}><i className="bi bi-clock-history" /></div>
            <div className={styles.queueBody}>
              <div className={styles.queueLabel}>Total Decisions</div>
              <div className={styles.queueValue}>{stats?.reviewedByMe ?? 0}</div>
              <div className={styles.queueDescription}>All approval actions recorded under your account.</div>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.actions}>
        <Link href="/approvals"><Button><i className="bi bi-check2-square" /> Review VC Approvals</Button></Link>
        <Link href="/requisitions"><Button variant="secondary">View Requisitions</Button></Link>
      </div>
    </div>
  );
}
