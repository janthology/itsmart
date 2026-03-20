import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import assetsRouter from "./assets";
import ticketsRouter from "./tickets";
import usersRouter from "./users";
import categoriesRouter from "./categories";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/assets", assetsRouter);
router.use("/tickets", ticketsRouter);
router.use("/users", usersRouter);
router.use("/categories", categoriesRouter);
router.use("/dashboard", dashboardRouter);

export default router;
