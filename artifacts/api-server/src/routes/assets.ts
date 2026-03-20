import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { db, assetsTable, usersTable } from "@workspace/db";
import { eq, like, and, sql } from "drizzle-orm";
import { authMiddleware, requireRole, formatUser, type AuthenticatedRequest } from "../lib/auth";

const router: IRouter = Router();

router.use(authMiddleware);

function formatAsset(asset: typeof assetsTable.$inferSelect, assignedUser?: typeof usersTable.$inferSelect | null) {
  return {
    id: asset.id,
    assetTag: asset.assetTag,
    name: asset.name,
    category: asset.category,
    status: asset.status,
    assignedTo: assignedUser ? formatUser(assignedUser) : null,
    purchaseDate: asset.purchaseDate,
    notes: asset.notes,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

router.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const { status, category, assignedTo, search, page = "1", limit = "20" } = req.query as Record<string, string>;

    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];

    if (user.role === "general_user") {
      conditions.push(eq(assetsTable.assignedToId, user.id));
    }

    if (status) conditions.push(eq(assetsTable.status, status as any));
    if (category) conditions.push(eq(assetsTable.category, category as any));
    if (assignedTo) conditions.push(eq(assetsTable.assignedToId, assignedTo));
    if (search) {
      conditions.push(
        sql`(${assetsTable.name} ILIKE ${'%' + search + '%'} OR ${assetsTable.assetTag} ILIKE ${'%' + search + '%'})`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [assets, [{ count }]] = await Promise.all([
      db
        .select()
        .from(assetsTable)
        .where(whereClause)
        .limit(limitNum)
        .offset(offset)
        .orderBy(assetsTable.createdAt),
      db
        .select({ count: sql<number>`count(*)` })
        .from(assetsTable)
        .where(whereClause),
    ]);

    const userIds = [...new Set(assets.map((a) => a.assignedToId).filter(Boolean))];
    const users = userIds.length > 0
      ? await db.select().from(usersTable).where(sql`${usersTable.id} = ANY(${userIds})`)
      : [];
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    res.json({
      data: assets.map((a) => formatAsset(a, a.assignedToId ? userMap[a.assignedToId] : null)),
      total: Number(count),
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    req.log.error(err, "Get assets error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireRole("administrator"), async (req: AuthenticatedRequest, res) => {
  try {
    const { assetTag, name, category, status, assignedToId, purchaseDate, notes } = req.body;

    if (!assetTag || !name || !category || !status) {
      res.status(400).json({ error: "Bad Request", message: "Required fields missing" });
      return;
    }

    const id = uuidv4();
    const [asset] = await db
      .insert(assetsTable)
      .values({ id, assetTag, name, category, status, assignedToId: assignedToId ?? null, purchaseDate: purchaseDate ?? null, notes: notes ?? null })
      .returning();

    let assignedUser = null;
    if (asset.assignedToId) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, asset.assignedToId)).limit(1);
      assignedUser = u ?? null;
    }

    res.status(201).json(formatAsset(asset, assignedUser));
  } catch (err) {
    req.log.error(err, "Create asset error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, req.params.id)).limit(1);

    if (!asset) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    if (user.role === "general_user" && asset.assignedToId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    let assignedUser = null;
    if (asset.assignedToId) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, asset.assignedToId)).limit(1);
      assignedUser = u ?? null;
    }

    res.json(formatAsset(asset, assignedUser));
  } catch (err) {
    req.log.error(err, "Get asset error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireRole("administrator"), async (req: AuthenticatedRequest, res) => {
  try {
    const { name, category, status, assignedToId, purchaseDate, notes } = req.body;

    const [updated] = await db
      .update(assetsTable)
      .set({
        ...(name && { name }),
        ...(category && { category }),
        ...(status && { status }),
        assignedToId: assignedToId !== undefined ? (assignedToId || null) : undefined,
        ...(purchaseDate !== undefined && { purchaseDate: purchaseDate || null }),
        ...(notes !== undefined && { notes: notes || null }),
        updatedAt: new Date(),
      })
      .where(eq(assetsTable.id, req.params.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Not Found" });
      return;
    }

    let assignedUser = null;
    if (updated.assignedToId) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, updated.assignedToId)).limit(1);
      assignedUser = u ?? null;
    }

    res.json(formatAsset(updated, assignedUser));
  } catch (err) {
    req.log.error(err, "Update asset error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/:id", requireRole("administrator"), async (req: AuthenticatedRequest, res) => {
  try {
    const [deleted] = await db.delete(assetsTable).where(eq(assetsTable.id, req.params.id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    res.json({ success: true, message: "Asset deleted" });
  } catch (err) {
    req.log.error(err, "Delete asset error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
