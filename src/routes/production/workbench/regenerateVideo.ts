import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import type { ReferenceList } from "@/utils/ai";

const router = express.Router();

type UploadDataItem = { id: number; sources: "assets" | "storyboard" };

function normalizeMode(mode: string | string[]) {
  if (Array.isArray(mode)) return mode;
  if (typeof mode === "string" && mode.startsWith('["') && mode.endsWith('"]')) {
    try {
      return JSON.parse(mode);
    } catch {}
  }
  return mode;
}

function isReferenceMode(mode: string | string[]) {
  const normalized = normalizeMode(mode);
  return Array.isArray(normalized);
}

function referenceCount(mode: string | string[], prefix: "imageReference" | "audioReference" | "backgroundImage") {
  const normalized = normalizeMode(mode);
  if (!Array.isArray(normalized)) return 0;
  const item = normalized.find((value) => value.toLowerCase().startsWith(`${prefix.toLowerCase()}:`));
  if (!item) return 0;
  const num = Number(item.split(":")[1]);
  return Number.isFinite(num) ? num : 0;
}

function audioReferenceCount(mode: string | string[]) {
  return referenceCount(mode, "audioReference");
}

function imageReferenceCount(mode: string | string[]) {
  return referenceCount(mode, "imageReference");
}

function backgroundImageCount(mode: string | string[]) {
  return referenceCount(mode, "backgroundImage");
}

async function loadModelPrompt(model: string, mode: string | string[]) {
  const [vendorId, modelData] = model.split(/:(.+)/);
  const videoPrompt = await u.db("o_prompt").where("type", "videoPromptGeneration").first();
  let videoPromptGeneration = "" as string | undefined;

  const modelPromptData = await u.db("o_modelPrompt").where("vendorId", vendorId || "").where("model", modelData || "").first();
  if (modelPromptData?.path) {
    const modelPromptRoot = u.getPath(["modelPrompt"]);
    try {
      videoPromptGeneration = await fs.readFile(path.join(modelPromptRoot, modelPromptData.path), "utf-8");
    } catch {}
  }

  if (!videoPromptGeneration) {
    const modelPromptRoot = u.getPath(["modelPrompt"]);
    const videoPromptDir = path.join(modelPromptRoot, "video");
    const modelLower = (modelData ?? "").toLowerCase();
    const normalizedMode = normalizeMode(mode);
    let fileName: string | null = null;

    if (modelLower.includes("wan") && modelLower.includes("2.6")) {
      fileName = "wan2.6Single-imageFirstFrameMode.md";
    } else if (/seedance.*2[.\-]0/i.test(modelLower)) {
      fileName = "seedance2Multi-parameterMode.md";
    } else if (normalizedMode === "startEndRequired" || normalizedMode === "endFrameOptional" || normalizedMode === "startFrameOptional") {
      fileName = "universalFirstAndLastFrameMode.md";
    } else if (Array.isArray(normalizedMode)) {
      fileName = "universalMulti-parameterMode.md";
    }

    if (fileName) {
      try {
        videoPromptGeneration = await fs.readFile(path.join(videoPromptDir, fileName), "utf-8");
      } catch {}
    }
  }

  if (!videoPromptGeneration) {
    videoPromptGeneration = videoPrompt?.useData || videoPrompt?.data || "";
  }
  return { modelData, videoPromptGeneration };
}

async function buildTrackUploadData(projectId: number, scriptId: number, trackId: number, mode: string | string[]) {
  const storyboardRows = await u
    .db("o_storyboard")
    .where({ projectId, scriptId, trackId })
    .orderBy("index", "asc")
    .select("id", "filePath");
  const storyboardRefs: UploadDataItem[] = storyboardRows
    .filter((row) => row.filePath && Number.isFinite(row.id))
    .map((row) => ({ id: row.id as number, sources: "storyboard" }));

  if (!isReferenceMode(mode)) return storyboardRefs;

  const storyIds = storyboardRows.map((row) => row.id).filter((id): id is number => Number.isFinite(id));
  const assetRows = storyIds.length
    ? await u
        .db("o_assets2Storyboard")
        .leftJoin("o_assets", "o_assets2Storyboard.assetId", "o_assets.id")
        .leftJoin("o_image", "o_assets.imageId", "o_image.id")
        .whereIn("o_assets2Storyboard.storyboardId", storyIds)
        .orderBy("o_assets2Storyboard.rowid")
        .select("o_assets.id", "o_assets.assetsId", "o_image.filePath")
    : [];

  const seen = new Set<number>();
  const assetRefs: UploadDataItem[] = [];
  const queryAudioIds: number[] = [];
  for (const asset of assetRows) {
    if (!asset.id || seen.has(asset.id)) continue;
    seen.add(asset.id);
    if (asset.filePath) assetRefs.push({ id: asset.id, sources: "assets" });
    if (asset.id) queryAudioIds.push(asset.id);
    if (asset.assetsId) queryAudioIds.push(asset.assetsId);
  }

  const imageAssetRefs = [...assetRefs];
  const audioRefs: UploadDataItem[] = [];
  const audioLimit = audioReferenceCount(mode);
  if (audioLimit > 0 && queryAudioIds.length) {
    const audioRows = await u
      .db("o_assetsRole2Audio")
      .leftJoin("o_assets", "o_assets.assetsId", "o_assetsRole2Audio.assetsAudioId")
      .leftJoin("o_image", "o_image.id", "o_assets.imageId")
      .whereIn("o_assetsRole2Audio.assetsRoleId", queryAudioIds)
      .select("o_assets.id", "o_image.filePath");
    let usedAudioCount = 0;
    for (const audio of audioRows) {
      if (usedAudioCount >= audioLimit) break;
      if (!audio.id || !audio.filePath || seen.has(audio.id)) continue;
      seen.add(audio.id);
      audioRefs.push({ id: audio.id, sources: "assets" });
      usedAudioCount += 1;
    }
  }

  if (backgroundImageCount(mode) > 0) {
    const imageLimit = imageReferenceCount(mode);
    const leadingAssets = imageLimit > 0 ? imageAssetRefs.slice(0, imageLimit) : imageAssetRefs;
    const trailingAssets = imageLimit > 0 ? imageAssetRefs.slice(imageLimit) : [];
    return [...leadingAssets, ...storyboardRefs, ...trailingAssets, ...audioRefs];
  }

  return [...imageAssetRefs, ...storyboardRefs, ...audioRefs];
}

async function buildPromptForTrack(projectId: number, trackId: number, uploadData: UploadDataItem[], model: string, mode: string | string[]) {
  const images = await Promise.all(
    uploadData.map(async (item) => {
      if (item.sources === "storyboard") {
        const storyboard = await u
          .db("o_storyboard")
          .where("o_storyboard.id", item.id)
          .select("videoDesc", "prompt", "track", "duration", "shouldGenerateImage")
          .first();
        const assetRows = await u.db("o_assets2Storyboard").where("storyboardId", item.id).orderBy("rowid").select("assetId");
        return {
          ...storyboard,
          associateAssetsIds: assetRows.map((row: any) => row.assetId),
          _type: "storyboard",
        };
      }
      const assetsData = await u
        .db("o_assets")
        .leftJoin("o_image", "o_image.id", "o_assets.imageId")
        .where("o_assets.id", item.id)
        .select("o_assets.id", "o_assets.type", "o_assets.name", "o_image.filePath")
        .first();
      return { ...assetsData, _type: "assets" };
    }),
  );

  const assets: any[] = [];
  const storyboards: any[] = [];
  for (const item of images) {
    if (!item) continue;
    if (item._type === "assets") {
      assets.push({ id: item.id, type: item.type, name: item.name, filePath: item.filePath });
    } else if (item._type === "storyboard") {
      storyboards.push({
        videoDesc: item.videoDesc,
        prompt: item.prompt,
        track: item.track,
        duration: item.duration,
        associateAssetsIds: item.associateAssetsIds,
        shouldGenerateImage: item.shouldGenerateImage,
      });
    }
  }

  const [projectData, { modelData, videoPromptGeneration }] = await Promise.all([
    u.db("o_project").select("*").where({ id: projectId }).first(),
    loadModelPrompt(model, mode),
  ]);
  const visualManual = u.getArtPrompt(projectData?.artStyle || "无", "art_skills", "art_storyboard_video");
  const content = `
          **模型名称**：${modelData},

          **资产信息**（角色、场景、道具、音频):${assets
            .filter((item) => item.filePath)
            .map((item) => `[${item.id},${item.type},${item.name}]`)
            .join("，")},
          **分镜信息**：${storyboards.map(
            (item) => `<storyboardItem
  videoDesc='${item.videoDesc}'
  duration='${item.duration}'
></storyboardItem>`,
          )},
          `;

  await u.db("o_videoTrack").where({ id: trackId }).update({ state: "生成中" });
  const { text } = await u.Ai.Text("universalAi").invoke({
    system: videoPromptGeneration,
    messages: [
      { role: "assistant", content: `${visualManual}` },
      { role: "user", content },
    ],
  });
  await u.db("o_videoTrack").where({ id: trackId }).update({ state: "已完成", prompt: text });
  return text;
}

async function loadReferenceList(uploadData: UploadDataItem[]) {
  const images = await Promise.all(
    uploadData.map(async (item) => {
      if (item.sources === "storyboard") {
        const filePath = await u.db("o_storyboard").where("id", item.id).select("filePath").first();
        return { path: filePath?.filePath, sources: "storyboard" };
      }
      const filePath = await u
        .db("o_assets")
        .where("o_assets.id", item.id)
        .leftJoin("o_image", "o_assets.imageId", "o_image.id")
        .select("o_image.filePath", "o_assets.type as assetType", "o_image.type as imageType")
        .first();
      const sourceType = filePath?.assetType === "audio" || filePath?.imageType === "audio" ? "audio" : "image";
      return { path: filePath?.filePath, sources: sourceType };
    }),
  );

  const refs = await Promise.all(
    images.map(async (item) => {
      if (!item?.path) return null;
      return {
        base64: await u.oss.getImageBase64(item.path),
        type: item.sources === "audio" ? "audio" : "image",
      };
    }),
  );
  return refs.filter(Boolean) as ReferenceList[];
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    trackId: z.number(),
    model: z.string(),
    mode: z.union([z.string(), z.array(z.string())]),
    resolution: z.string(),
    duration: z.number().optional(),
    audio: z.boolean().optional(),
    autoSelect: z.boolean().optional(),
    regeneratePrompt: z.boolean().optional(),
  }),
  async (req, res) => {
    const {
      projectId,
      scriptId,
      trackId,
      model,
      mode,
      resolution,
      audio,
      autoSelect = false,
      regeneratePrompt = true,
    } = req.body;
    const normalizedMode = normalizeMode(mode);
    const track = await u.db("o_videoTrack").where({ id: trackId, projectId, scriptId }).first();
    if (!track) return res.status(400).send(error("视频片段不存在"));
    const uploadData = await buildTrackUploadData(projectId, scriptId, trackId, mode);
    if (!uploadData.length) return res.status(400).send(error("当前片段没有可用于生成视频的分镜图或参考图"));

    const ratio = await u.db("o_project").select("videoRatio").where("id", projectId).first();
    const duration = req.body.duration ?? Number(track.duration || 5);
    const videoPath = `/${projectId}/video/${uuidv4()}.mp4`;
    const [videoId] = await u.db("o_video").insert({
      filePath: videoPath,
      time: Date.now(),
      state: "生成中",
      scriptId,
      projectId,
      videoTrackId: trackId,
      model,
      mode: JSON.stringify(normalizedMode),
      resolution,
      audio: audio ? 1 : 0,
      source: "fallback-regenerate",
      prompt: regeneratePrompt ? "" : track.prompt || "",
    });

    res.status(200).send(success({ videoId, trackId, model, mode: normalizedMode, autoSelect }));

    let promptReady = false;
    try {
      const prompt = regeneratePrompt ? await buildPromptForTrack(projectId, trackId, uploadData, model, mode) : track.prompt || "";
      if (!prompt) throw new Error("当前片段缺少视频提示词");
      promptReady = true;
      await u.db("o_video").where("id", videoId).update({ prompt });
      const referenceList = await loadReferenceList(uploadData);
      const aiVideo = u.Ai.Video(model);
      await aiVideo.run(
        {
          prompt,
          referenceList,
          mode: normalizedMode,
          duration,
          aspectRatio: (ratio?.videoRatio as "16:9" | "9:16") || "16:9",
          resolution,
          audio,
        },
        {
          projectId,
          taskClass: "片段换模型重生",
          describe: `片段 ${trackId} 使用 ${model} 重生`,
          relatedObjects: JSON.stringify({ projectId, scriptId, trackId, videoId, model, type: "视频" }),
        },
      );
      await aiVideo.save(videoPath);
      await u.db("o_video").where("id", videoId).update({ state: "生成成功" });
      if (autoSelect) await u.db("o_videoTrack").where("id", trackId).update({ videoId });
    } catch (e) {
      if (!promptReady) {
        await u.db("o_videoTrack").where("id", trackId).update({
          state: "生成失败",
          reason: u.error(e).message,
        });
      }
      await u
        .db("o_video")
        .where("id", videoId)
        .update({
          state: "生成失败",
          errorReason: u.error(e).message,
        });
    }
  },
);
