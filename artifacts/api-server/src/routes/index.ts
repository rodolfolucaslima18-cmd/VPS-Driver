import { Router, type IRouter } from "express";
import healthRouter from "./health";
import filesRouter from "./files";
import setupRouter from "./setup";
import downloadRouter from "./download";
import adminRouter from "./admin";
import shareRouter from "./share";

const router: IRouter = Router();

router.use(healthRouter);
router.use(filesRouter);
router.use(setupRouter);
router.use(downloadRouter);
router.use(adminRouter);
router.use(shareRouter);

export default router;
