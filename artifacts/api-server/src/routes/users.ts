import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { authMiddleware, requireRole, formatUser, type AuthenticatedRequest } from "../lib/auth";

const router: IRouter = Router();

router.use(authMiddleware);

router.get("/", requireRole("administrator"), async (req: AuthenticatedRequest, res) => {
  try {
    const { role, department, search } = req.query as Record<string, string>;
    const conditions = [];

    if (role) conditions.push(eq(usersTable.role, role as any));
    if (department) conditions.push(eq(usersTable.department, department));
    if (search) {
      conditions.push(sql`(${usersTable.fullName} ILIKE ${'%' + search + '%'} OR ${usersTable.email} ILIKE ${'%' + search + '%'})`);
    }

    const whereClause = conditions.length > 0 ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}` : undefined;
    const users = await db.select().from(usersTable).where(whereClause).orderBy(usersTable.createdAt);
    res.json(users.map(formatUser));
  } catch (err) {
    req.log.error(err, "Get users error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/profile", async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const { fullName, department } = req.body;

    const [updated] = await db
      .update(usersTable)
      .set({
        ...(fullName && { fullName }),
        ...(department !== undefined && { department: department || null }),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, user.id))
      .returning();

    res.json(formatUser(updated));
  } catch (err) {
    req.log.error(err, "Update profile error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/:id", async (req: AuthenticatedRequest, res) => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).limit(1);
    if (!user) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    res.json(formatUser(user));
  } catch (err) {
    req.log.error(err, "Get user error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/:id", requireRole("administrator"), async (req: AuthenticatedRequest, res) => {
  try {
    const { fullName, role, department } = req.body;
    const [updated] = await db
      .update(usersTable)
      .set({
        ...(fullName && { fullName }),
        ...(role && { role }),
        ...(department !== undefined && { department: department || null }),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, req.params.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
    res.json(formatUser(updated));
  } catch (err) {
    req.log.error(err, "Update user error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
