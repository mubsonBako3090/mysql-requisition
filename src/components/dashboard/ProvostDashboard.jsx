"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";
import Button from "@/components/ui/Button";
import styles from "./dashboard-grid.module.css";

export default function ProvostDashboard({ user }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    axios.get("/api/dashboard").then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  const cards = [
    ["Awaiting My Decision", stats?.pendingMyStep, "bi-hourglass-split", "pending", "/approvals", "Requisitions currently waiting for your college-level decision."],
    ["Ready for Consolidation", stats?.readyForConsolidation, "bi-diagram-3", "pending", "/requisitions/consolidate", "Eligible requisitions within your college that can be consolidated."],
    ["My Consolidations", stats?.myConsolidations, "bi-collection", "approved", "/requisitions/consolidate", "Consolidated representatives created by you."],
    ["Returned", stats?.returnedInScope, "bi-arrow-repeat", "", "/requisitions?status=returned", "College requisitions returned for clarification or correction."],
    ["Approved", stats?.approvedInScope, "bi-check-circle", "approved", "/requisitions?status=approved", "College requisitions that have completed approval."],
    ["Rejected", stats?.rejectedInScope, "bi-x-circle", "rejected", "/requisitions?status=rejected", "College requisitions with a rejection outcome."],
  ];

  return (
    <div className={styles.wrapper}>
      <div>
        <h1 className={styles.heading}>Welcome, {user.fullName.split(" ")[0]}</h1>
        <p className={styles.subheading}>Provost — {user.collegeName || "College"}</p>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>College Decision & Consolidation</h2>
            <p className={styles.sectionSubtitle}>Focus on college-level decisions and requisitions ready to be consolidated before moving onward in the approval chain.</p>
          </div>
        </div>
        <div className={styles.statGrid}>
          {cards.map(([label, value, icon, tone, href, description]) => (
            <Link href={href} className={styles.queueCard} key={label}>
              <div className={styles.queueIcon}><i className={`bi ${icon}`} /></div>
              <div className={styles.queueBody}>
                <div className={styles.queueLabel}>{label}</div>
                <div className={`${styles.queueValue} ${tone === "pending" ? styles.queueValuePending : tone === "approved" ? styles.queueValueApproved : tone === "rejected" ? styles.queueValueRejected : ""}`}>{value ?? 0}</div>
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
            <p className={styles.sectionSubtitle}>Your approval activity across requisitions handled at your college level.</p>
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
        <Link href="/approvals"><Button><i className="bi bi-check2-square" /> Review My Decisions</Button></Link>
        <Link href="/requisitions/consolidate"><Button variant="secondary"><i className="bi bi-diagram-3" /> Consolidate Requisitions</Button></Link>
        <Link href="/requisitions"><Button variant="secondary">View College Requisitions</Button></Link>
      </div>
    </div>
  );
}
