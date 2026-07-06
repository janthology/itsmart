import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth-context";

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

type NotificationsContextType = {
  notifications: Notification[];
  unreadCount: number;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextType>({
  notifications: [],
  unreadCount: 0,
  markRead: async () => {},
  markAllRead: async () => {},
  clearAll: async () => {},
});

// Days ahead to warn about upcoming PM dates
const PM_WARN_DAYS = 7;

async function checkAndInsertPMNotifications(userId: string, userRole: string) {
  // Only admins and support staff receive PM notifications
  if (userRole === 'general_user') return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const warningDate = new Date(today);
  warningDate.setDate(warningDate.getDate() + PM_WARN_DAYS);

  // Fetch assets with next_pm_date within the warning window and not retired
  const { data: assets, error } = await supabase
    .from('assets')
    .select('id, asset_tag, name, next_pm_date')
    .not('next_pm_date', 'is', null)
    .neq('status', 'retired')
    .lte('next_pm_date', warningDate.toISOString().split('T')[0]);

  if (error || !assets || assets.length === 0) return;

  for (const asset of assets) {
    const pmDate = new Date(asset.next_pm_date);
    pmDate.setHours(0, 0, 0, 0);
    const isOverdue = pmDate < today;
    const isToday = pmDate.getTime() === today.getTime();
    const daysUntil = Math.ceil((pmDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    const notifType = isOverdue ? 'pm_overdue' : isToday ? 'pm_due_today' : 'pm_due_soon';
    const title = isOverdue
      ? `PM Overdue: ${asset.name}`
      : isToday
      ? `PM Due Today: ${asset.name}`
      : `PM Due Soon: ${asset.name}`;
    const body = isOverdue
      ? `Preventive maintenance for ${asset.asset_tag} was due on ${new Date(asset.next_pm_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}. Please schedule immediately.`
      : isToday
      ? `Preventive maintenance for ${asset.asset_tag} is due today.`
      : `Preventive maintenance for ${asset.asset_tag} is due on ${new Date(asset.next_pm_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}.`;

    // Deduplication: only send once per asset + type + pm_date combination.
    // This prevents daily spam — a new notification is only created when the
    // PM date itself changes (i.e. after maintenance is actually logged).
    const dedupBody = body; // body contains the PM date so it serves as the unique key
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('type', notifType)
      .eq('link', `/assets/${asset.id}`)
      .eq('body', dedupBody)
      .limit(1);

    if (existing && existing.length > 0) continue;

    await supabase.from('notifications').insert({
      user_id: userId,
      type: notifType,
      title,
      body,
      link: `/assets/${asset.id}`,
      is_read: false,
    });
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const mapRow = (r: any): Notification => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    isRead: r.is_read,
    createdAt: r.created_at,
  });

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setNotifications(data.map(mapRow));
  }, [user?.id]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    fetchNotifications();

    // Check for PM-due assets and insert notifications once per session
    checkAndInsertPMNotifications(user.id, user.role ?? 'general_user')
      .then(() => fetchNotifications()); // refresh after inserting

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          setNotifications((prev) => [mapRow(payload.new), ...prev]);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          setNotifications((prev) =>
            prev.map((n) => (n.id === payload.new.id ? mapRow(payload.new) : n))
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isAuthenticated, user?.id, fetchNotifications]);

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n));
  };

  const markAllRead = async () => {
    if (!user?.id) return;
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const clearAll = async () => {
    if (!user?.id) return;
    await supabase.from("notifications").delete().eq("user_id", user.id);
    setNotifications([]);
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markRead, markAllRead, clearAll }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
