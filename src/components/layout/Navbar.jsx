"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import { ROLE_LABELS } from "@/constants/roles";
import styles from "./Navbar.module.css";

export default function Navbar() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clearUser = useAuthStore((s) => s.clearUser);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await axios.get("/api/notifications?limit=1");
      setUnreadCount(Number(data.unreadCount || 0));
    } catch {
      // Keep the navigation usable if notifications are temporarily unavailable.
    }
  }, [user]);

  useEffect(() => {
    loadUnreadCount();
    const handleUpdated = () => loadUnreadCount();
    window.addEventListener("notifications:updated", handleUpdated);
    return () => window.removeEventListener("notifications:updated", handleUpdated);
  }, [loadUnreadCount]);

  async function handleLogout() {
    try {
      await axios.post("/api/auth/logout");
      clearUser();
      router.push("/login");
    } catch (err) {
      toast.error("Logout failed.");
    }
  }

  return (
    <header className={styles.navbar}>
      <button className={styles.toggleBtn} onClick={toggleSidebar} aria-label="Toggle sidebar">
        <i className="bi bi-list" />
      </button>

      <div className={styles.spacer} />

      {user && (
        <div className={styles.userMenu}>
          <Link href="/notifications" className={styles.notificationBtn} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} title="Notifications">
            <i className="bi bi-bell" />
            {unreadCount > 0 && <span className={styles.notificationBadge}>{unreadCount > 99 ? "99+" : unreadCount}</span>}
          </Link>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{user.fullName}</span>
            <span className={styles.userRole}>{ROLE_LABELS[user.role]}</span>
          </div>
          <button className={styles.logoutBtn} onClick={handleLogout} title="Log out">
            <i className="bi bi-box-arrow-right" />
          </button>
        </div>
      )}
    </header>
  );
}
