import fs from "node:fs/promises";
import path from "node:path";
import compressing from "compressing";
import u from "@/utils";
import { assetTypeConfig, buildAssetImagePrompt } from "@/lib/assetImagePrompt";
import type { AssetType } from "@/lib/assetImagePrompt";

export type PromptPackageKind = "asset" | "storyboard";

export interface PromptPackageReference {
  kind: "asset";
  id: number;
  name: string;
  type: string;
  file: string;
  sourcePath: string;
}

export interface PromptPackageItem {
  kind: PromptPackageKind;
  id: number;
  type?: string;
  name?: string;
  promptFile: string;
  suggestedOutput: string;
  size: string;
  aspectRatio: string;
  references: PromptPackageReference[];
}

export interface PromptPackageManifest {
  version: "1.0";
  packageType: "toonflow-image-prompt-package";
  projectId: number;
  scriptId: number | null;
  createdAt: string;
  source: "toonflow";
  items: PromptPackageItem[];
}

export interface PromptPackageFile {
  path: string;
  content: string;
}

export interface BuiltPromptPackage {
  manifest: PromptPackageManifest;
  files: PromptPackageFile[];
  referenceFiles: PromptPackageReference[];
}

interface BuildOptions {
  projectId: number;
  scriptId?: number | null;
  assetIds?: number[];
  storyboardIds?: number[];
  includeAssets?: boolean;
  includeStoryboards?: boolean;
  includeReferences?: boolean;
}

interface ImportItem {
  kind: PromptPackageKind;
  id: number;
  base64Data?: string;
  base64?: string;
  fileName?: string;
  resolution?: string;
}

interface ImportOptions {
  projectId: number;
  scriptId?: number | null;
  source?: string;
  items: ImportItem[];
}

function compactName(value: string | null | undefined, fallback: string) {
  const raw = (value || fallback).trim();
  return raw
    .replace(/\s+/g, "-")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

function asUniqueNumbers(values?: number[]) {
  return [...new Set((values || []).filter((value) => Number.isFinite(value)))];
}

function imageExtFromPath(filePath: string) {
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return ext || "jpg";
}

function referencePath(asset: any) {
  return `references/asset-${asset.id}-${compactName(asset.name, "asset")}.${imageExtFromPath(asset.filePath || "")}`;
}

function promptPath(item: { kind: PromptPackageKind; id: number; type?: string; name?: string }) {
  const suffix = item.kind === "asset" ? `${item.type || "asset"}-${compactName(item.name, "asset")}` : "storyboard";
  return `prompts/${item.kind}-${item.id}-${suffix}.md`;
}

function outputPath(item: { kind: PromptPackageKind; id: number; type?: string; name?: string }) {
  const suffix = item.kind === "asset" ? `${item.type || "asset"}-${compactName(item.name, "asset")}` : "storyboard";
  return `outputs/${item.kind}-${item.id}-${suffix}.png`;
}

function buildAssetPromptFile(asset: any, prompt: string, suggestedOutput: string) {
  return `# ${asset.name || `Asset ${asset.id}`}

生成目标：${asset.type || "asset"} 资产图
输出文件名：${suggestedOutput}

请使用下面的提示词生成图片，并把最终图片保存为上述输出文件名。

\`\`\`text
${prompt.trim()}
\`\`\`
`;
}

function buildStoryboardPromptFile(storyboard: any, references: PromptPackageReference[], suggestedOutput: string) {
  const referenceText = references.length
    ? references.map((ref, index) => `${index + 1}. ${ref.name} (${ref.type}) -> ${ref.file}`).join("\n")
    : "无";

  return `# Storyboard ${storyboard.id}

生成目标：分镜图
输出文件名：${suggestedOutput}

参考图：
${referenceText}

请使用下面的提示词生成图片。若存在参考图，请同时使用这些参考图保持角色、场景、道具一致性。

\`\`\`text
${(storyboard.prompt || "").trim()}
\`\`\`

视频描述：
${storyboard.videoDesc || "无"}
`;
}

function buildCodexBatch(manifest: PromptPackageManifest) {
  const lines = manifest.items.map((item, index) => {
    const refs = item.references.length ? `，参考图：${item.references.map((ref) => ref.file).join(", ")}` : "";
    return `${index + 1}. 读取 ${item.promptFile}${refs}，生成图片并保存为 ${item.suggestedOutput}`;
  });

  return `# Codex ImageGen Batch

请按顺序生成以下图片。每张图片必须使用对应 prompt 文件的完整提示词，输出文件名必须和 suggestedOutput 完全一致，方便 Toonflow 批量导入。

${lines.join("\n")}

完成后，把 outputs 目录中的图片与 manifest.json 一起导入 Toonflow。
`;
}

async function loadProject(projectId: number) {
  const project = await u
    .db("o_project")
    .where("id", projectId)
    .select("id", "name", "artStyle", "imageQuality", "videoRatio")
    .first();
  if (!project) throw new Error("项目不存在");
  return project;
}

async function loadAssets(projectId: number, assetIds?: number[]) {
  let query = u
    .db("o_assets")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .where("o_assets.projectId", projectId)
    .whereIn("o_assets.type", ["role", "scene", "tool"])
    .select(
      "o_assets.id",
      "o_assets.name",
      "o_assets.prompt",
      "o_assets.type",
      "o_assets.imageId",
      "o_image.filePath",
    );
  const ids = asUniqueNumbers(assetIds);
  if (ids.length) query = query.whereIn("o_assets.id", ids);
  return query.orderBy("o_assets.id", "asc");
}

async function loadStoryboards(projectId: number, scriptId?: number | null, storyboardIds?: number[]) {
  const ids = asUniqueNumbers(storyboardIds);
  if (!scriptId && !ids.length) return [];

  let query = u
    .db("o_storyboard")
    .where("projectId", projectId)
    .select("id", "scriptId", "prompt", "videoDesc", "shouldGenerateImage", "filePath", "state", "index");
  if (scriptId) query = query.where("scriptId", scriptId);
  if (ids.length) query = query.whereIn("id", ids);
  return query.orderBy("index", "asc").orderBy("id", "asc");
}

async function loadStoryboardReferences(storyboardIds: number[]) {
  if (!storyboardIds.length) return {};
  const rows = await u
    .db("o_assets2Storyboard")
    .leftJoin("o_assets", "o_assets2Storyboard.assetId", "o_assets.id")
    .leftJoin("o_image", "o_assets.imageId", "o_image.id")
    .whereIn("o_assets2Storyboard.storyboardId", storyboardIds)
    .orderBy("rowid")
    .select(
      "o_assets2Storyboard.storyboardId",
      "o_assets.id",
      "o_assets.name",
      "o_assets.type",
      "o_image.filePath",
    );

  const result: Record<number, PromptPackageReference[]> = {};
  for (const row of rows) {
    if (!row.filePath) continue;
    if (!result[row.storyboardId]) result[row.storyboardId] = [];
    result[row.storyboardId].push({
      kind: "asset",
      id: row.id,
      name: row.name || `Asset ${row.id}`,
      type: row.type || "asset",
      file: referencePath(row),
      sourcePath: row.filePath,
    });
  }
  return result;
}

export async function buildPromptPackage(options: BuildOptions): Promise<BuiltPromptPackage> {
  const project = await loadProject(options.projectId);
  const includeAssets = options.includeAssets !== false;
  const includeStoryboards = options.includeStoryboards !== false;
  const includeReferences = options.includeReferences !== false;

  const [assets, storyboards] = await Promise.all([
    includeAssets ? loadAssets(options.projectId, options.assetIds) : Promise.resolve([]),
    includeStoryboards ? loadStoryboards(options.projectId, options.scriptId, options.storyboardIds) : Promise.resolve([]),
  ]);
  const storyboardReferenceMap = await loadStoryboardReferences(storyboards.map((item: any) => item.id));

  const items: PromptPackageItem[] = [];
  const files: PromptPackageFile[] = [];
  const referenceFilesByPackagePath = new Map<string, PromptPackageReference>();

  for (const asset of assets) {
    const cfg = assetTypeConfig[asset.type as AssetType];
    if (!cfg) continue;
    const promptFile = promptPath({ kind: "asset", id: asset.id, type: asset.type, name: asset.name });
    const suggestedOutput = outputPath({ kind: "asset", id: asset.id, type: asset.type, name: asset.name });
    const prompt = buildAssetImagePrompt(cfg, project.artStyle || "", asset.name || "", asset.prompt || "");
    const references: PromptPackageReference[] = [];
    if (includeReferences && asset.filePath) {
      const ref = {
        kind: "asset" as const,
        id: asset.id,
        name: asset.name || `Asset ${asset.id}`,
        type: asset.type || "asset",
        file: referencePath(asset),
        sourcePath: asset.filePath,
      };
      references.push(ref);
      referenceFilesByPackagePath.set(ref.file, ref);
    }
    items.push({
      kind: "asset",
      id: asset.id,
      type: asset.type,
      name: asset.name,
      promptFile,
      suggestedOutput,
      size: project.imageQuality || "2K",
      aspectRatio: project.videoRatio || "16:9",
      references,
    });
    files.push({ path: promptFile, content: buildAssetPromptFile(asset, prompt, suggestedOutput) });
  }

  for (const storyboard of storyboards) {
    const references = includeReferences ? storyboardReferenceMap[storyboard.id] || [] : [];
    for (const ref of references) referenceFilesByPackagePath.set(ref.file, ref);
    const promptFile = promptPath({ kind: "storyboard", id: storyboard.id });
    const suggestedOutput = outputPath({ kind: "storyboard", id: storyboard.id });
    items.push({
      kind: "storyboard",
      id: storyboard.id,
      promptFile,
      suggestedOutput,
      size: project.imageQuality || "2K",
      aspectRatio: project.videoRatio || "16:9",
      references,
    });
    files.push({ path: promptFile, content: buildStoryboardPromptFile(storyboard, references, suggestedOutput) });
  }

  const manifest: PromptPackageManifest = {
    version: "1.0",
    packageType: "toonflow-image-prompt-package",
    projectId: options.projectId,
    scriptId: options.scriptId ?? null,
    createdAt: new Date().toISOString(),
    source: "toonflow",
    items,
  };
  files.unshift({ path: "manifest.json", content: JSON.stringify(manifest, null, 2) });
  files.push({ path: "codex-batch.md", content: buildCodexBatch(manifest) });

  return {
    manifest,
    files,
    referenceFiles: [...referenceFilesByPackagePath.values()],
  };
}

export async function writePromptPackageZip(pkg: BuiltPromptPackage, projectId: number) {
  const id = u.uuid();
  const rootDir = u.getPath(["temp", `prompt-package-${id}`]);
  const sourceDir = path.join(rootDir, "package");
  const zipAbsPath = path.join(rootDir, `toonflow-prompt-package-${projectId}-${id}.zip`);
  await fs.mkdir(sourceDir, { recursive: true });
  try {
    for (const file of pkg.files) {
      const absPath = path.join(sourceDir, file.path);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, file.content, "utf-8");
    }
    await fs.mkdir(path.join(sourceDir, "outputs"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "outputs", ".gitkeep"), "", "utf-8");

    for (const ref of pkg.referenceFiles) {
      const absPath = path.join(sourceDir, ref.file);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      try {
        await fs.writeFile(absPath, await u.oss.getFile(ref.sourcePath));
      } catch {}
    }

    await compressing.zip.compressDir(sourceDir, zipAbsPath);
    const zipBuffer = await fs.readFile(zipAbsPath);
    const zipPath = `/promptPackages/${projectId}/toonflow-prompt-package-${id}.zip`;
    await u.oss.writeFile(zipPath, zipBuffer);
    return {
      zipPath,
      zipUrl: await u.oss.getFileUrl(zipPath),
    };
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

function parseImageBase64(base64Data: string, fileName?: string) {
  const mimeMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const dataUrlMatch = base64Data.match(/^data:([^;]+);base64,([\s\S]+)$/);
  const mime = dataUrlMatch?.[1] || "";
  const rawBase64 = dataUrlMatch?.[2] || base64Data;
  const extFromName = fileName ? path.extname(fileName).replace(/^\./, "").toLowerCase() : "";
  const ext = mimeMap[mime] || extFromName || "png";
  if (!["jpg", "jpeg", "png", "webp"].includes(ext)) throw new Error(`不支持的图片格式: ${ext}`);
  return {
    buffer: Buffer.from(rawBase64, "base64"),
    ext: ext === "jpeg" ? "jpg" : ext,
  };
}

export async function importGeneratedImages(options: ImportOptions) {
  const source = options.source || "manual-prompt-package";
  const imported: any[] = [];
  const failed: any[] = [];

  for (const item of options.items) {
    try {
      const rawBase64 = item.base64Data || item.base64;
      if (!rawBase64) throw new Error("缺少 base64Data");
      const image = parseImageBase64(rawBase64, item.fileName);

      if (item.kind === "asset") {
        const asset = await u.db("o_assets").where({ id: item.id, projectId: options.projectId }).select("id", "type").first();
        if (!asset) throw new Error("资产不存在");
        const cfg = assetTypeConfig[asset.type as AssetType];
        if (!cfg) throw new Error(`不支持的资产类型: ${asset.type}`);
        const savePath = `/${options.projectId}/${cfg.dir}/manual/${u.uuid()}.${image.ext}`;
        await u.oss.writeFile(savePath, image.buffer);
        const [imageId] = await u.db("o_image").insert({
          assetsId: item.id,
          filePath: savePath,
          type: asset.type,
          state: "已完成",
          model: source,
          resolution: item.resolution || "",
        });
        await u.db("o_assets").where("id", item.id).update({ imageId });
        imported.push({ kind: item.kind, id: item.id, imageId, filePath: savePath, url: await u.oss.getSmallImageUrl(savePath) });
      } else {
        let query = u.db("o_storyboard").where({ id: item.id, projectId: options.projectId });
        if (options.scriptId) query = query.where("scriptId", options.scriptId);
        const storyboard = await query.select("id", "scriptId").first();
        if (!storyboard) throw new Error("分镜不存在");
        const savePath = `/${options.projectId}/assets/${storyboard.scriptId || options.scriptId || "manual"}/manual/${u.uuid()}.${image.ext}`;
        await u.oss.writeFile(savePath, image.buffer);
        await u.db("o_storyboard").where("id", item.id).update({
          filePath: savePath,
          state: "已完成",
          shouldGenerateImage: 1,
        });
        imported.push({ kind: item.kind, id: item.id, filePath: savePath, url: await u.oss.getSmallImageUrl(savePath) });
      }
    } catch (e) {
      failed.push({ kind: item.kind, id: item.id, reason: u.error(e).message });
    }
  }

  return { imported, failed };
}
