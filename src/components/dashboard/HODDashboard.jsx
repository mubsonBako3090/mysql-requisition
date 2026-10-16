"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";
import StatCard from "@/components/ui/StatCard";
import Button from "@/components/ui/Button";
import styles from "./dashboard-grid.module.css";

export default function HODDashboard({ user }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    axios.get("/api/dashboard").then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  return (
    <div className={styles.wrapper}>
      <div>
        <h1 className={styles.heading}>Welcome, {user.fullName.split(" ")[0]}</h1>
        <p className={styles.subheading}>Head of Department — {user.department}</p>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>My Requisitions</h2>
            <p className={styles.sectionSubtitle}>Track requisitions you initiated and their current status.</p>
          </div>
        </div>

        <div className={styles.statGrid}>
          <Link href="/requisitions?status=draft" className={styles.queueCard}>
            <div className={styles.queueIcon}><i className="bi bi-file-earmark" /></div>
            <div className={styles.queueBody}>
              <div className={styles.queueLabel}>Drafts</div>
              <div className={styles.queueValue}>{stats?.draftCount ?? 0}</div>
              <div className={styles.queueDescription}>Continue unfinished requisitions.</div>
            </div>
            <i className={`bi bi-chevron-right ${styles.queueArrow}`} />
          </Link>

          <Link href="/requisitions?status=pending" className={styles.queueCard}>
            <div className={styles.queueIcon}><i className="bi bi-hourglass-split" /></div>
            <div className={styles.queueBody}>
              <div className={styles.queueLabel}>Pending Approval</div>
              <div className={`${styles.queueValue} ${styles.queueValuePending}`}>{stats?.pendingCount ?? 0}</div>
              <div className={styles.queueDescription}>Your submitted requisitions still in the workflow.</div>
            </div>
            <i className={`bi bi-chevron-right ${styles.queueArrow}`} />
          </Link>

          <Link href="/requisitions?status=returned" className={styles.queueCard}>
            <div className={styles.queueIcon}><i className="bi bi-arrow-repeat" /></div>
            <div className={styles.queueBody}>
              <div className={styles.queueLabel}>Returned</div>
              <div className={styles.queueValue}>{stats?.returnedCount ?? 0}</div>
              <div className={styles.queueDescription}>Requisitions needing your correction or resubmission.</div>
            </div>
            <i className={`bi bi-chevron-right ${styles.queueArrow}`} />
          </Link>

          <Link href="/requisitions?status=approved" className={styles.queueCard}>
            <div className={styles.queueIcon}><i className="bi bi-check-circle" /></div>
            <div className={styles.queueBody}>
              <div className={styles.queueLabel}>Approved</div>
              <div className={`${styles.queueValue} ${styles.queueValueApproved}`}>{stats?.approvedCount ?? 0}</div>
              <div className={styles.queueDescription}>Your requisitions that have completed approval.</div>
            </div>
            <i className={`bi bi-chevron-right ${styles.queueArrow}`} />
          </Link>

          <Link href="/requisitions?status=rejected" className={styles.queueCard}>
            <div className={styles.queueIcon}><i className="bi bi-x-circle" /></div>
            <div className={styles.queueBody}>
              <div className={styles.queueLabel}>Rejected</div>
              <div className={`${styles.queueValue} ${styles.queueValueRejected}`}>{stats?.rejectedCount ?? 0}</div>
              <div className={styles.queueDescription}>Your requisitions with a rejection outcome.</div>
            </div>
            <i className={`bi bi-chevron-right ${styles.queueArrow}`} />
          </Link>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>My Approval Desk</h2>
            <p className={styles.sectionSubtitle}>Decisions assigned to you as Head of Department.</p>
          </div>
        </div>

        <div className={styles.statGrid}>
          <Link href="/approvals" className={styles.queueCard}>
            <div className={styles.queueIcon}><i className="bi bi-check2-square" /></div>
            <div className={styles.queueBody}>
              <div className={styles.queueLabel}>Awaiting Your Approval</div>
              <div className={`${styles.queueValue} ${styles.queueValuePending}`}>{stats?.pendingMyStep ?? 0}</div>
              <div className={styles.queueDescription}>Requisitions currently waiting for your decision.</div>
            </div>
            <i className={`bi bi-chevron-right ${styles.queueArrow}`} />
          </Link>

          <Link href="/approvals" className={styles.queueCard}>
            <div className={styles.queueIcon}><i className="bi bi-clock-history" /></div>
            <div className={styles.queueBody}>
              <div className={styles.queueLabel}>Decisions Made</div>
              <div className={styles.queueValue}>{stats?.reviewedByMe ?? 0}</div>
              <div className={styles.queueDescription}>Total approval actions recorded under your account.</div>
            </div>
            <i className={`bi bi-chevron-right ${styles.queueArrow}`} />
          </Link>
        </div>
      </section>

      <div className={styles.actions}>
        <Link href="/requisitions/new">
          <Button><i className="bi bi-plus-lg" /> New Requisition</Button>
        </Link>
        <Link href="/requisitions">
          <Button variant="secondary">View My Requisitions</Button>
        </Link>
        <Link href="/approvals">
          <Button variant="secondary"><i className="bi bi-check2-square" /> Review Approvals</Button>
        </Link>
      </div>
    </div>
  );
}
