import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { db, ticketsTable, ticketCommentsTable, usersTable, assetsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { authMiddleware, requireRole, formatUser, type AuthenticatedRequest } from "../lib/auth";

const router: IRouter = Router();

router.use(authMiddleware);

function formatTicket(
  ticket: typeof ticketsTable.$inferSelect,
  createdBy: typeof usersTable.$inferSelect,
  assignedTo?: typeof usersTable.$inferSelect | null,
  asset?: typeof assetsTable.$inferSelect | null
) {
  return {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    asset: asset ? {
      id: asset.id,
      assetTag: asset.assetTag,
      name: asset.name,
      category: asset.category,
      status: asset.status,
      assignedTo: null,
      purchaseDate: asset.purchaseDate,
      notes: asset.notes,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
    } : null,
    createdBy: formatUser(createdBy),
    assignedTo: assignedTo ? formatUser(assignedTo) : null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    closedAt: ticket.closedAt?.toISOString() ?? null,
  };
}

function formatComment(
  comment: typeof ticketCommentsTable.$inferSelect,
  createdBy: typeof usersTable.$inferSelect
) {
  return {
    id: comment.id,
    ticketId: comment.ticketId,
    commentText: comment.commentText,
    createdBy: formatUser(createdBy),
    createdAt: comment.createdAt.toISOString(),
  };
}

router.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const { status, priority, assetId, assignedTo, search, page = "1", limit = "20" } = req.query as Record<string, string>;

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];

    if (user.role === "general_user") {
      conditions.push(eq(ticketsTable.createdById, user.id));
    }

    if (status) conditions.push(eq(ticketsTable.status, status as any));
    if (priority) conditions.push(eq(ticketsTable.priority, priority as any));
    if (assetId) conditions.push(eq(ticketsTable.assetId, assetId));
    if (assignedTo) conditions.push(eq(ticketsTable.assignedToId, assignedTo));
    if (search) {
      conditions.push(sql`${ticketsTable.title} ILIKE ${'%' + search + '%'}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [tickets, [{ count }]] = await Promise.all([
      db.select().from(ticketsTable).where(whereClause).limit(limitNum).offset(offset).orderBy(sql`${ticketsTable.createdAt} DESC`),
      db.select({ count: sql<number>`count(*)` }).from(ticketsTable).where(whereClause),
    ]);

    const userIds = [...new Set([
      ...tickets.map(t => t.createdById),
      ...tickets.map(t => t.assignedToId).filter(Boolean),
    ])];
    const assetIds = [...new Set(tickets.map(t => t.assetId).filter(Boolean))];

    const [users, assets] = await Promise.all([
      userIds.length > 0 ? db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${userIds})`) : [],
      assetIds.length > 0 ? db.select().from(assetsTable).where(sql`${assetsTable.id} = ANY(${assetIds})`) : [],
    ]);

    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    const assetMap = Object.fromEntries(assets.map(a => [a.id, a]));

    res.json({
      data: tickets.map(t => formatTicket(
        t,
        userMap[t.createdById],
        t.assignedToId ? userMap[t.assignedToId] : null,
        t.assetId ? assetMap[t.assetId] : null
      )),
      total: Number(count),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    req.log.error(err, "Get tickets error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const { title, description, priority, assetId } = req.body;

    if (!title || !description || !priority) {
      res.status(400).json({ error: "Bad Request", message: "title, description, priority required" });
      return;
    }

    const id = uuidv4();
    const [ticket] = await db
      .insert(ticketsTable)
      .values({
        id,
        title,
        description,
        priority,
        status: "open",
        createdById: user.id,
        assetId: assetId ?? null,
      })
      .returning();

    let asset = null;
    if (ticket.assetId) {
      const [a] = await db.select().from(assetsTable).where(eq(assetsTable.id, ticket.assetId)).limit(1);
      asset = a ?? null;
    }

    res.status(201).json(formatTicket(ticket, user, null, asset));
  } catch (err) {
    req.log.error(err, "Create ticket error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, req.params.id)).limit(1);

    if (!ticket) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    if (user.role === "general_user" && ticket.createdById !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const comments = await db
      .select()
      .from(ticketCommentsTable)
      .where(eq(ticketCommentsTable.ticketId, ticket.id))
      .orderBy(ticketCommentsTable.createdAt);

    const userIds = [...new Set([
      ticket.createdById,
      ticket.assignedToId,
      ...comments.map(c => c.createdById),
    ].filter(Boolean) as string[])];

    const assetIds = [ticket.assetId].filter(Boolean) as string[];

    const [users, assets] = await Promise.all([
      db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${userIds})`),
      assetIds.length > 0 ? db.select().from(assetsTable).where(sql`${assetsTable.id} = ANY(${assetIds})`) : [],
    ]);

    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    const assetMap = Object.fromEntries(assets.map(a => [a.id, a]));

    res.json({
      ...formatTicket(
        ticket,
        userMap[ticket.createdById],
        ticket.assignedToId ? userMap[ticket.assignedToId] : null,
        ticket.assetId ? assetMap[ticket.assetId] : null
      ),
      comments: comments.map(c => formatComment(c, userMap[c.createdById])),
    });
  } catch (err) {
    req.log.error(err, "Get ticket error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, req.params.id)).limit(1);

    if (!ticket) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    if (user.role === "general_user") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { title, description, status, priority, assignedToId } = req.body;

    const closedAt = (status === "closed" || status === "resolved") && ticket.status !== "closed" && ticket.status !== "resolved"
      ? new Date()
      : ticket.closedAt;

    const [updated] = await db
      .update(ticketsTable)
      .set({
        ...(title && { title }),
        ...(description && { description }),
        ...(status && { status }),
        ...(priority && { priority }),
        ...(assignedToId !== undefined && { assignedToId: assignedToId || null }),
        closedAt,
        updatedAt: new Date(),
      })
      .where(eq(ticketsTable.id, req.params.id))
      .returning();

    const userIds = [updated.createdById, updated.assignedToId].filter(Boolean) as string[];
    const users = await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${userIds})`);
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    let asset = null;
    if (updated.assetId) {
      const [a] = await db.select().from(assetsTable).where(eq(assetsTable.id, updated.assetId)).limit(1);
      asset = a ?? null;
    }

    res.json(formatTicket(updated, userMap[updated.createdById], updated.assignedToId ? userMap[updated.assignedToId] : null, asset));
  } catch (err) {
    req.log.error(err, "Update ticket error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/:id/comments", async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const { commentText } = req.body;

    if (!commentText?.trim()) {
      res.status(400).json({ error: "Bad Request", message: "commentText required" });
      return;
    }

    const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, req.params.id)).limit(1);
    if (!ticket) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    if (user.role === "general_user" && ticket.createdById !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const id = uuidv4();
    const [comment] = await db
      .insert(ticketCommentsTable)
      .values({ id, ticketId: ticket.id, createdById: user.id, commentText })
      .returning();

    res.status(201).json(formatComment(comment, user));
  } catch (err) {
    req.log.error(err, "Add comment error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
