import { Router, type IRouter } from "express";
import { db, assetsTable, ticketsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { authMiddleware, formatUser, type AuthenticatedRequest } from "../lib/auth";

const router: IRouter = Router();

router.use(authMiddleware);

router.get("/stats", async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const isRestricted = user.role === "general_user";

    const [
      [{ totalAssets }],
      [{ assignedAssets }],
      [{ availableAssets }],
      [{ inMaintenanceAssets }],
      [{ openTickets }],
      [{ inProgressTickets }],
      [{ resolvedTickets }],
      [{ totalUsers }],
    ] = await Promise.all([
      db.select({ totalAssets: sql<number>`count(*)` }).from(assetsTable)
        .where(isRestricted ? eq(assetsTable.assignedToId, user.id) : undefined),
      db.select({ assignedAssets: sql<number>`count(*)` }).from(assetsTable)
        .where(isRestricted
          ? sql`${assetsTable.status} = 'assigned' AND ${assetsTable.assignedToId} = ${user.id}`
          : eq(assetsTable.status, "assigned")),
      db.select({ availableAssets: sql<number>`count(*)` }).from(assetsTable)
        .where(isRestricted
          ? sql`${assetsTable.status} = 'available' AND ${assetsTable.assignedToId} = ${user.id}`
          : eq(assetsTable.status, "available")),
      db.select({ inMaintenanceAssets: sql<number>`count(*)` }).from(assetsTable)
        .where(isRestricted
          ? sql`${assetsTable.status} = 'in_maintenance' AND ${assetsTable.assignedToId} = ${user.id}`
          : eq(assetsTable.status, "in_maintenance")),
      db.select({ openTickets: sql<number>`count(*)` }).from(ticketsTable)
        .where(isRestricted
          ? sql`${ticketsTable.status} = 'open' AND ${ticketsTable.createdById} = ${user.id}`
          : eq(ticketsTable.status, "open")),
      db.select({ inProgressTickets: sql<number>`count(*)` }).from(ticketsTable)
        .where(isRestricted
          ? sql`${ticketsTable.status} = 'in_progress' AND ${ticketsTable.createdById} = ${user.id}`
          : eq(ticketsTable.status, "in_progress")),
      db.select({ resolvedTickets: sql<number>`count(*)` }).from(ticketsTable)
        .where(isRestricted
          ? sql`${ticketsTable.status} = 'resolved' AND ${ticketsTable.createdById} = ${user.id}`
          : eq(ticketsTable.status, "resolved")),
      db.select({ totalUsers: sql<number>`count(*)` }).from(usersTable),
    ]);

    const recentTicketsRaw = await db
      .select()
      .from(ticketsTable)
      .where(isRestricted ? eq(ticketsTable.createdById, user.id) : undefined)
      .orderBy(sql`${ticketsTable.createdAt} DESC`)
      .limit(5);

    const recentAssetsRaw = await db
      .select()
      .from(assetsTable)
      .where(isRestricted ? eq(assetsTable.assignedToId, user.id) : undefined)
      .orderBy(sql`${assetsTable.createdAt} DESC`)
      .limit(5);

    const userIds = [...new Set([
      ...recentTicketsRaw.map(t => t.createdById),
      ...recentTicketsRaw.map(t => t.assignedToId).filter(Boolean),
    ])] as string[];

    const users = userIds.length > 0
      ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${userIds})`)
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const recentTickets = recentTicketsRaw.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      asset: null,
      createdBy: formatUser(userMap[t.createdById] ?? { id: t.createdById, email: "", fullName: "Unknown", role: "general_user" as const, department: null, createdAt: new Date(), updatedAt: new Date(), passwordHash: "" }),
      assignedTo: t.assignedToId ? formatUser(userMap[t.assignedToId]) : null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      closedAt: t.closedAt?.toISOString() ?? null,
    }));

    const recentAssets = recentAssetsRaw.map(a => ({
      id: a.id,
      assetTag: a.assetTag,
      name: a.name,
      category: a.category,
      status: a.status,
      assignedTo: null,
      purchaseDate: a.purchaseDate,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }));

    res.json({
      totalAssets: Number(totalAssets),
      assignedAssets: Number(assignedAssets),
      availableAssets: Number(availableAssets),
      inMaintenanceAssets: Number(inMaintenanceAssets),
      openTickets: Number(openTickets),
      inProgressTickets: Number(inProgressTickets),
      resolvedTickets: Number(resolvedTickets),
      totalUsers: Number(totalUsers),
      recentTickets,
      recentAssets,
    });
  } catch (err) {
    req.log.error(err, "Dashboard stats error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
