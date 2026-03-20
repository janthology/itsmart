import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, authMiddleware, formatUser, type AuthenticatedRequest } from "../lib/auth";

const router: IRouter = Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "Bad Request", message: "Email and password required" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid credentials" });
      return;
    }

    const token = signToken(user.id);
    res.json({ user: formatUser(user), token });
  } catch (err) {
    req.log.error(err, "Login error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { email, password, fullName, department } = req.body;
    if (!email || !password || !fullName) {
      res.status(400).json({ error: "Bad Request", message: "Email, password, and fullName required" });
      return;
    }

    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      res.status(400).json({ error: "Bad Request", message: "Email already in use" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    const [user] = await db
      .insert(usersTable)
      .values({
        id,
        email: email.toLowerCase(),
        passwordHash,
        fullName,
        department: department ?? null,
        role: "general_user",
      })
      .returning();

    const token = signToken(user.id);
    res.status(201).json({ user: formatUser(user), token });
  } catch (err) {
    req.log.error(err, "Register error");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/me", authMiddleware, async (req: AuthenticatedRequest, res) => {
  res.json(formatUser(req.user!));
});

router.post("/logout", (_req, res) => {
  res.json({ success: true, message: "Logged out" });
});

export default router;
