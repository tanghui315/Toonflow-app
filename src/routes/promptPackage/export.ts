import express from "express";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { buildPromptPackage, writePromptPackageZip } from "@/lib/promptPackage";
import u from "@/utils";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional().nullable(),
    assetIds: z.array(z.number()).optional(),
    storyboardIds: z.array(z.number()).optional(),
    includeAssets: z.boolean().optional(),
    includeStoryboards: z.boolean().optional(),
    includeReferences: z.boolean().optional(),
    asZip: z.boolean().optional(),
  }),
  async (req, res) => {
    try {
      const pkg = await buildPromptPackage(req.body);
      const zip = req.body.asZip ? await writePromptPackageZip(pkg, req.body.projectId) : null;
      return res.status(200).send(
        success({
          manifest: pkg.manifest,
          files: pkg.files,
          referenceFiles: pkg.referenceFiles.map((item) => ({
            kind: item.kind,
            id: item.id,
            name: item.name,
            type: item.type,
            file: item.file,
            sourcePath: item.sourcePath,
          })),
          zip,
        }),
      );
    } catch (e) {
      return res.status(400).send(error(u.error(e).message));
    }
  },
);
