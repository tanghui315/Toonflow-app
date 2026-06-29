import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { importGeneratedImages } from "@/lib/promptPackage";
import u from "@/utils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
    source: z.string().optional(),
    items: z
      .array(
        z.object({
          kind: z.enum(["asset", "storyboard"]),
          id: z.number(),
          base64Data: z.string().optional(),
          base64: z.string().optional(),
          fileName: z.string().optional(),
          resolution: z.string().optional(),
        }),
      )
      .min(1),
  }),
  async (req, res) => {
    try {
      const result = await importGeneratedImages(req.body);
      if (!result.imported.length && result.failed.length) {
        return res.status(400).send(error("导入失败", result));
      }
      return res.status(200).send(success(result));
    } catch (e) {
      return res.status(400).send(error(u.error(e).message));
    }
  },
);
