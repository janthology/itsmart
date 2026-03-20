import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { db, categoriesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { authMiddleware, requireRole, type AuthenticatedRequest } from "../lib/auth";

const router: IRouter = Router();

router.use(authMiddleware);

function formatCategory(cat: typeof categoriesTable.$inferSelect) {
  return {
    id: cat.id,
    name: cat.name,
    type: cat.type,
    createdAt: cat.createdAt.toISOString(),
  };
}

router.get("/", async (req: AuthenticatedRequest, res) => {
  try {
    const { type } = req.query as Record<string, string>;
    const cats = await db
      .select()
      .from(categoriesTable)
      .where(type ? eq(categoriesTable.type, type) : undefined)
      .orderBy(categoriesTable.name);
    res.json(cats.map(formatCategory));
  } catch (err) {
    req.log.error(err, "Get categories error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/", requireRole("administrator"), async (req: AuthenticatedRequest, res) => {
  try {
    const { name, type } = req.body;
    if (!name || !type) {
      res.status(400).json({ error: "Bad Request", message: "name and type required" });
      return;
    }
    const id = uuidv4();
    const [cat] = await db.insert(categoriesTable).values({ id, name, type }).returning();
    res.status(201).json(formatCategory(cat));
  } catch (err) {
    req.log.error(err, "Create category error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireRole("administrator"), async (req: AuthenticatedRequest, res) => {
  try {
    const { name, type } = req.body;
    const [updated] = await db
      .update(categoriesTable)
      .set({ ...(name && { name }), ...(type && { type }) })
      .where(eq(categoriesTable.id, req.params.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    res.json(formatCategory(updated));
  } catch (err) {
    req.log.error(err, "Update category error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/:id", requireRole("administrator"), async (req: AuthenticatedRequest, res) => {
  try {
    const [deleted] = await db.delete(categoriesTable).where(eq(categoriesTable.id, req.params.id)).returning();
    if (!deleted) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    res.json({ success: true, message: "Category deleted" });
  } catch (err) {
    req.log.error(err, "Delete category error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
