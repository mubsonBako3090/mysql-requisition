"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import styles from "./page.module.css";

function timeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get("/api/notifications");
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(Number(data.unreadCount || 0));
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markRead(notification) {
    if (notification.readAt) return;
    try {
      await axios.patch("/api/notifications", { id: notification._id });
      setNotifications((items) => items.map((item) =>
        item._id === notification._id ? { ...item, readAt: new Date().toISOString() } : item
      ));
      setUnreadCount((count) => Math.max(0, count - 1));
      window.dispatchEvent(new Event("notifications:updated"));
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to mark notification as read.");
    }
  }

  async function markAllRead() {
    if (!unreadCount || updating) return;
    setUpdating(true);
    try {
      await axios.patch("/api/notifications", { all: true });
      const now = new Date().toISOString();
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt || now })));
      setUnreadCount(0);
      window.dispatchEvent(new Event("notifications:updated"));
      toast.success("All notifications marked as read.");
    } catch (error) {
      toast.error(error.response?.data?.message || "Unable to update notifications.");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.headingRow}>
        <div>
          <h1 className={styles.heading}>Notifications</h1>
          <p className={styles.subheading}>{unreadCount} unread notification{unreadCount === 1 ? "" : "s"}</p>
        </div>
        <button className={styles.markAllButton} onClick={markAllRead} disabled={!unreadCount || updating}>
          <i className="bi bi-check2-all" /> {updating ? "Updating…" : "Mark all as read"}
        </button>
      </div>

      {loading ? <p className={styles.hint}>Loading notifications…</p> : notifications.length === 0 ? (
        <div className={styles.empty}>
          <i className="bi bi-bell" />
          <strong>You’re all caught up</strong>
          <span>Updates about requisition activity will appear here.</span>
        </div>
      ) : (
        <div className={styles.list}>
          {notifications.map((notification) => {
            const content = (
              <>
                <span className={`${styles.statusIcon} ${styles[notification.type] || styles.info}`}>
                  <i className={`bi ${notification.type === "success" ? "bi-check-circle" : notification.type === "warning" ? "bi-exclamation-circle" : notification.type === "error" ? "bi-x-circle" : "bi-bell"}`} />
                </span>
                <span className={styles.notificationBody}>
                  <span className={styles.titleLine}>
                    <strong>{notification.title}</strong>
                    {!notification.readAt && <span className={styles.unreadDot} aria-label="Unread" />}
                  </span>
                  <span className={styles.message}>{notification.message}</span>
                  {notification.requisitionNumber && <span className={styles.reference}>Requisition: {notification.requisitionNumber}</span>}
                  <span className={styles.date}>{timeLabel(notification.createdAt)}</span>
                </span>
                {!notification.readAt && <span className={styles.newLabel}>New</span>}
              </>
            );
            return notification.href && notification.requisition ? (
              <Link key={notification._id} href={notification.href} className={`${styles.item} ${!notification.readAt ? styles.unread : ""}`} onClick={() => markRead(notification)}>
                {content}
              </Link>
            ) : (
              <button key={notification._id} type="button" className={`${styles.item} ${styles.itemButton} ${!notification.readAt ? styles.unread : ""}`} onClick={() => markRead(notification)}>
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
