"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";

import StatCard from "@/components/ui/StatCard";
import Button from "@/components/ui/Button";
import { PROCUREMENT_POSITIONS } from "@/constants/procurement";

import styles from "./dashboard-grid.module.css";

function QueueCard({ href, label, value, icon, tone = "pending", description }) {
  return (
    <Link href={href} className={styles.queueCard}>
      <div className={styles.queueIcon}>
        <i className={`bi ${icon}`} />
      </div>
      <div className={styles.queueBody}>
        <div className={styles.queueLabel}>{label}</div>
        <div className={`${styles.queueValue} ${styles[`queueValue${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>
          {value}
        </div>
        <div className={styles.queueDescription}>{description}</div>
      </div>
      <i className={`bi bi-chevron-right ${styles.queueArrow}`} />
    </Link>
  );
}

export default function ProcurementDashboard({ user }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const { data } = await axios.get("/api/dashboard");
        setStats(data);
      } catch (error) {
        console.error("Failed to load Procurement dashboard:", error);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  const isDirector = user?.procurementPosition === PROCUREMENT_POSITIONS.DIRECTOR;
  const isAssignmentManager =
    user?.procurementPosition === PROCUREMENT_POSITIONS.DIRECTOR ||
    user?.procurementPosition === PROCUREMENT_POSITIONS.PRINCIPAL_SENIOR;

  const value = (key) => (loading ? "..." : stats?.[key] ?? 0);

  return (
    <div className={styles.wrapper}>
      <div>
        <h1 className={styles.heading}>
          Welcome, {user.fullName.split(" ")[0]}
        </h1>
        <p className={styles.subheading}>
          {user?.procurementPositionLabel || "Procurement Directorate Staff"}
        </p>
      </div>

      <div className={styles.actions}>
        <Link href="/approvals?stage=market-survey">
          <Button>
            <i className="bi bi-inbox" /> {isDirector ? "Procurement Intake" : "My Market Survey Queue"}
          </Button>
        </Link>
        {isAssignmentManager && (
          <Link href="/approvals?stage=market-survey">
            <Button variant="secondary">
              <i className="bi bi-person-check" /> Assign Market Survey
            </Button>
          </Link>
        )}
        {isDirector && (
          <Link href="/approvals?stage=director-review">
            <Button variant="secondary">
              <i className="bi bi-clipboard-check" /> Director Review
            </Button>
          </Link>
        )}
        <Link href="/approvals?stage=awaiting-vc">
          <Button variant="secondary">
            <i className="bi bi-building-up" /> Awaiting VC
          </Button>
        </Link>
        <Link href="/requisitions?status=approved">
          <Button variant="secondary">
            <i className="bi bi-check-circle" /> Accepted
          </Button>
        </Link>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Procurement Work Queue</h2>
            <p className={styles.sectionSubtitle}>
              Work that still needs Procurement attention before the final hand-off.
            </p>
          </div>
        </div>

        <div className={styles.queueGrid}>
          <QueueCard
            href="/approvals?stage=market-survey"
            label={isDirector ? "Pending Intake" : "My Market Survey"}
            value={value("marketSurveyCount")}
            icon="bi-inbox"
            tone="pending"
            description={isDirector ? "Requisitions waiting for Procurement market-survey action." : "Market surveys currently assigned to you."}
          />
          {isDirector && (
            <QueueCard
              href="/approvals?stage=director-review"
              label="Director Review"
              value={value("directorReviewCount")}
              icon="bi-clipboard-check"
              tone="pending"
              description="Completed market surveys waiting for Director review or consolidation."
            />
          )}
          <QueueCard
            href="/approvals?stage=awaiting-vc"
            label="Awaiting VC"
            value={value("awaitingVcCount")}
            icon="bi-building-up"
            tone="pending"
            description="Market-surveyed requisitions sent to the VC for final approval."
          />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Accepted &amp; Procurement Documents</h2>
            <p className={styles.sectionSubtitle}>
              Accepted requisitions are ready for Procurement consolidation and the subsequent procurement process.
            </p>
          </div>
        </div>

        <div className={styles.queueGrid}>
          <QueueCard
            href="/requisitions?status=approved"
            label="Accepted"
            value={value("acceptedCount")}
            icon="bi-check-circle"
            tone="approved"
            description="Accepted requisitions available for the next Procurement action."
          />
          <QueueCard
            href="/requisitions?status=approved"
            label="Consolidated Documents"
            value={value("acceptedConsolidatedCount")}
            icon="bi-file-earmark-pdf"
            tone="approved"
            description="Accepted Procurement consolidations ready to view or download as PDF."
          />
        </div>
      </section>

      <section className={styles.sectionCompact}>
        <div className={styles.statGrid}>
          <StatCard
            label="Rejected"
            value={value("rejectedCount")}
            icon="bi-x-circle"
            tone="rejected"
          />
          <StatCard
            label="Total Procurement Items"
            value={value("totalProcurementItems")}
            icon="bi-clipboard-data"
            tone="primary"
          />
        </div>
      </section>
    </div>
  );
}
