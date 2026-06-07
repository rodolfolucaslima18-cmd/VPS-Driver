import { Router, type IRouter } from "express";
import healthRouter from "./health";
import filesRouter from "./files";
import setupRouter from "./setup";
import downloadRouter from "./download";

const router: IRouter = Router();

router.use(healthRouter);
router.use(filesRouter);
router.use(setupRouter);
router.use(downloadRouter);

export default router;
