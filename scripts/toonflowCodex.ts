import * as fs from "node:fs/promises";
import * as path from "node:path";

interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

interface CliContext {
  baseUrl: string;
  username: string;
  password: string;
  token?: string;
  json: boolean;
}

interface ParsedArgs {
  command: string;
  options: Record<string, string | boolean>;
}

interface PromptPackageItem {
  kind: "asset" | "storyboard";
  id: number;
  promptFile: string;
  suggestedOutput: string;
  size?: string;
  aspectRatio?: string;
  references?: unknown[];
}

interface PromptPackageManifest {
  version: string;
  packageType: string;
  projectId: number;
  scriptId?: number | null;
  items: PromptPackageItem[];
}

interface PromptPackageFile {
  path: string;
  content: string;
}

interface ExportPromptPackageData {
  manifest: PromptPackageManifest;
  files: PromptPackageFile[];
  referenceFiles?: unknown[];
  zip?: {
    zipPath?: string;
    zipUrl?: string;
  } | null;
}

interface ImportPromptPackageResult {
  imported?: unknown[];
  failed?: unknown[];
}

interface RegenerateVideoResult {
  videoId: number;
  trackId: number;
  model: string;
  mode: string | string[];
  autoSelect: boolean;
}

interface VideoState {
  id: number;
  state: string;
  errorReason?: string;
  src?: string;
  model?: string;
  mode?: string;
  resolution?: string;
  audio?: boolean | number;
  source?: string;
  label?: string;
  prompt?: string;
}

interface ProjectItem {
  id: number;
  name: string;
  videoModel?: string;
  mode?: string;
}

interface ScriptItem {
  id: number;
  name: string;
  content: string;
}

interface VendorListItem {
  id: string;
  inputValues?: Record<string, string>;
  enable?: number;
}

interface AssetListItem {
  id: number;
  name: string;
  src?: string;
  filePath?: string;
}

interface StoryboardItem {
  id: number;
  trackId?: number;
  duration?: number;
}

interface GenerateData {
  storyboardList: StoryboardItem[];
  trackList: { id: number; duration?: number; prompt?: string }[];
}

const usage = `Toonflow Codex CLI

Usage:
  yarn toonflow:codex <command> [options]

Commands:
  login
  configure-runninghub --api-key <key> [--base-url <url>]
  create-ltx-msr-sample --script-path <path> --asset-map <path> --assets-dir <path> --background-image <path> [--duration <seconds>] [--poll]
  get-projects
  get-scripts --project-id <id>
  export-prompt-package --project-id <id> [--script-id <id>] [--out-dir <path>] [--zip]
  import-prompt-package --package-dir <path>
  get-video-tracks --project-id <id> --script-id <id>
  regenerate-video --project-id <id> --script-id <id> --track-id <id> --model <vendor:model> --mode <mode> --resolution <value> [--poll]
  poll-videos --project-id <id> --script-id <id> --video-ids <ids>

Shared options:
  --base-url <url>       Default: http://localhost:10588
  --username <name>      Default: TOONFLOW_USERNAME or admin
  --password <password>  Default: TOONFLOW_PASSWORD or admin123
  --token <token>        Bearer token or raw JWT
  --json                 Print final JSON only
`;

const mimeByExt: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const LTX_MSR_MODEL = "runninghub:ltx-2.3/cn-msr-workflow";
const LTX_MSR_MODE = ["imageReference:4", "backgroundImage:1"];

function toCamelCase(value: string) {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function parseArgs(argv: string[]): ParsedArgs {
  if (!argv[0] || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", options: { help: true } };
  }

  const command = !argv[0] || argv[0] === "--help" || argv[0] === "-h" ? "help" : argv[0];
  const options: Record<string, string | boolean> = {};

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`未知参数: ${token}`);
    }

    if (token.startsWith("--no-")) {
      options[toCamelCase(token.slice(5))] = false;
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex > 0) {
      options[toCamelCase(token.slice(2, eqIndex))] = token.slice(eqIndex + 1);
      continue;
    }

    const key = toCamelCase(token.slice(2));
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }

  return { command, options };
}

function hasOption(options: Record<string, string | boolean>, key: string) {
  return Object.prototype.hasOwnProperty.call(options, key);
}

function flagName(key: string) {
  return `--${key.replace(/[A-Z]/g, (s) => `-${s.toLowerCase()}`)}`;
}

function booleanOption(options: Record<string, string | boolean>, key: string, defaultValue = false) {
  if (!hasOption(options, key)) return defaultValue;
  const value = options[key];
  if (typeof value === "boolean") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  fail(`参数 ${flagName(key)} 必须是布尔值`);
}

function createContext(options: Record<string, string | boolean>): CliContext {
  return {
    baseUrl: String(options.baseUrl || "http://localhost:10588").replace(/\/+$/, ""),
    username: String(options.username || process.env.TOONFLOW_USERNAME || "admin"),
    password: String(options.password || process.env.TOONFLOW_PASSWORD || "admin123"),
    token: typeof options.token === "string" ? options.token : process.env.TOONFLOW_TOKEN,
    json: booleanOption(options, "json"),
  };
}

function normalizeToken(token: string) {
  const trimmed = token.trim();
  return trimmed.toLowerCase().startsWith("bearer ") ? trimmed : `Bearer ${trimmed}`;
}

function output(result: unknown) {
  console.log(JSON.stringify(result, null, 2));
}

function log(ctx: CliContext, message: string) {
  if (!ctx.json) console.error(message);
}

function fail(message: string): never {
  throw new Error(message);
}

function requireString(options: Record<string, string | boolean>, key: string) {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) fail(`缺少必填参数 ${flagName(key)}`);
  return value;
}

function optionalString(options: Record<string, string | boolean>, key: string) {
  const value = options[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requireNumber(options: Record<string, string | boolean>, key: string) {
  const value = Number(requireString(options, key));
  if (!Number.isFinite(value)) fail(`参数 ${key} 必须是数字`);
  return value;
}

function optionalNumber(options: Record<string, string | boolean>, key: string) {
  const value = optionalString(options, key);
  if (value == null) return undefined;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) fail(`参数 ${key} 必须是数字`);
  return numberValue;
}

function parseNumberList(value: string) {
  const rawItems = value.split(",").map((item) => item.trim());
  const result = rawItems.map((item) => Number(item));
  if (!result.length) fail(`数字列表为空: ${value}`);
  const invalid = rawItems.filter((item, index) => !item || !Number.isFinite(result[index]));
  if (invalid.length) fail(`数字列表包含非法项: ${invalid.join(", ")}`);
  return result;
}

function parseOptionalNumberList(options: Record<string, string | boolean>, key: string) {
  const value = optionalString(options, key);
  return value ? parseNumberList(value) : undefined;
}

function parseMode(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      fail("--mode JSON 数组只能包含字符串");
    }
    return parsed as string[];
  } catch (error) {
    fail(`--mode 不是有效 JSON 数组: ${(error as Error).message}`);
  }
}

function isInsideOrEqual(childPath: string, parentPath: string) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeJoin(rootDir: string, relativePath: string) {
  const normalized = relativePath.replace(/^[/\\]+/, "");
  const resolved = path.resolve(rootDir, normalized);
  const root = path.resolve(rootDir);
  if (!isInsideOrEqual(resolved, root)) fail(`路径越界: ${relativePath}`);
  return resolved;
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function login(ctx: CliContext) {
  const response = await fetch(`${ctx.baseUrl}/api/login/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ctx.username, password: ctx.password }),
  });
  return parseApiResponse<{ token: string; name: string; id: number }>(response);
}

async function getAuthHeader(ctx: CliContext) {
  if (ctx.token) return normalizeToken(ctx.token);
  const data = await login(ctx);
  ctx.token = data.token;
  return normalizeToken(data.token);
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: ApiResponse<T> | null;
  try {
    payload = raw ? (JSON.parse(raw) as ApiResponse<T>) : null;
  } catch {
    fail(`接口返回非 JSON 响应: HTTP ${response.status}${raw ? ` ${raw.slice(0, 500)}` : ""}`);
  }

  if (!response.ok) {
    fail(`接口请求失败: HTTP ${response.status} ${payload?.message || ""}`.trim());
  }
  if (!payload || payload.code !== 200) {
    fail(`接口业务失败: ${payload?.message || "未知错误"}`);
  }
  if (typeof payload.data === "undefined") {
    fail("接口响应缺少 data 字段");
  }
  return payload.data;
}

async function apiPost<T>(ctx: CliContext, apiPath: string, body: Record<string, unknown>) {
  const token = await getAuthHeader(ctx);
  const response = await fetch(`${ctx.baseUrl}${apiPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify(body),
  });
  return parseApiResponse<T>(response);
}

async function writeTextFile(rootDir: string, file: PromptPackageFile) {
  const target = safeJoin(rootDir, file.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, file.content, "utf-8");
}

async function downloadZip(ctx: CliContext, zipUrl: string, packageDir: string) {
  const absoluteUrl = new URL(zipUrl, `${ctx.baseUrl}/`).toString();
  const urlPath = new URL(absoluteUrl).pathname;
  const fallbackName = `toonflow-prompt-package-${timestampForPath()}.zip`;
  const fileName = path.basename(urlPath) || fallbackName;
  const zipDownloadPath = safeJoin(packageDir, fileName.endsWith(".zip") ? fileName : fallbackName);
  const response = await fetch(absoluteUrl);
  if (!response.ok) fail(`下载 zip 失败: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(zipDownloadPath, buffer);
  return zipDownloadPath;
}

function countPackageItems(items: PromptPackageItem[]) {
  return items.reduce(
    (acc, item) => {
      acc[item.kind] += 1;
      return acc;
    },
    { asset: 0, storyboard: 0 },
  );
}

async function commandLogin(ctx: CliContext) {
  const data = await login(ctx);
  output(data);
}

async function commandConfigureRunningHub(ctx: CliContext, options: Record<string, string | boolean>) {
  const apiKeyValue = requireString(options, "apiKey");
  const baseUrl = optionalString(options, "baseUrl") || "https://www.runninghub.cn";
  const vendorList = await apiPost<VendorListItem[]>(ctx, "/api/setting/vendorConfig/getVendorList", {});
  const runninghub = vendorList.find((item) => item.id === "runninghub");
  if (!runninghub) fail("未找到 RunningHub 供应商配置，请确认内置 vendor 已同步");

  await apiPost<string>(ctx, "/api/setting/vendorConfig/updateVendorInputs", {
    id: "runninghub",
    inputValues: {
      ...(runninghub.inputValues || {}),
      apiKey: apiKeyValue,
      baseUrl,
    },
  });
  await apiPost<string>(ctx, "/api/setting/vendorConfig/enableVendor", {
    id: "runninghub",
    enable: 1,
  });

  output({
    id: "runninghub",
    enabled: true,
    baseUrl,
    model: LTX_MSR_MODEL,
    mode: LTX_MSR_MODE,
  });
}

async function commandGetProjects(ctx: CliContext) {
  const data = await apiPost<unknown[]>(ctx, "/api/project/getProject", {});
  output({ count: Array.isArray(data) ? data.length : 0, projects: data });
}

async function commandGetScripts(ctx: CliContext, options: Record<string, string | boolean>) {
  const projectId = requireNumber(options, "projectId");
  const name = optionalString(options, "name");
  const data = await apiPost<unknown[]>(ctx, "/api/script/getScrptApi", { projectId, ...(name ? { name } : {}) });
  output({ projectId, count: Array.isArray(data) ? data.length : 0, scripts: data });
}

async function commandExportPromptPackage(ctx: CliContext, options: Record<string, string | boolean>) {
  const projectId = requireNumber(options, "projectId");
  const scriptId = optionalNumber(options, "scriptId");
  const assetIds = parseOptionalNumberList(options, "assetIds");
  const storyboardIds = parseOptionalNumberList(options, "storyboardIds");
  const body: Record<string, unknown> = {
    projectId,
    ...(scriptId != null ? { scriptId } : {}),
    ...(assetIds ? { assetIds } : {}),
    ...(storyboardIds ? { storyboardIds } : {}),
    ...(hasOption(options, "includeAssets") ? { includeAssets: booleanOption(options, "includeAssets") } : {}),
    ...(hasOption(options, "includeStoryboards") ? { includeStoryboards: booleanOption(options, "includeStoryboards") } : {}),
    ...(hasOption(options, "includeReferences") ? { includeReferences: booleanOption(options, "includeReferences") } : {}),
    asZip: booleanOption(options, "zip"),
  };

  log(ctx, "Exporting Toonflow prompt package...");
  const data = await apiPost<ExportPromptPackageData>(ctx, "/api/promptPackage/export", body);
  const outDir = optionalString(options, "outDir") || path.join("tmp", "toonflow-prompt-packages", timestampForPath());
  const packageDir = path.resolve(outDir);
  await fs.mkdir(packageDir, { recursive: true });

  for (const file of data.files || []) {
    await writeTextFile(packageDir, file);
  }
  await fs.mkdir(safeJoin(packageDir, "outputs"), { recursive: true });

  let zipDownloadPath: string | undefined;
  let zipDownloadError: string | undefined;
  if (data.zip?.zipUrl) {
    try {
      zipDownloadPath = await downloadZip(ctx, data.zip.zipUrl, packageDir);
    } catch (error) {
      zipDownloadError = (error as Error).message;
      log(ctx, `Zip download skipped: ${zipDownloadError}`);
    }
  }

  const summary = {
    projectId: data.manifest.projectId,
    scriptId: data.manifest.scriptId ?? null,
    packageDir,
    zipPath: data.zip?.zipPath ?? null,
    zipUrl: data.zip?.zipUrl ?? null,
    zipDownloadPath: zipDownloadPath ?? null,
    zipDownloadError: zipDownloadError ?? null,
    counts: countPackageItems(data.manifest.items || []),
  };
  output(summary);
}

async function readDataUrl(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = mimeByExt[ext];
  if (!mime) fail(`不支持的图片格式: ${filePath}`);
  const buffer = await fs.readFile(filePath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function fileExists(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function loadImageAsDataUrl(filePath: string) {
  const resolved = path.resolve(filePath);
  if (!(await fileExists(resolved))) fail(`图片不存在: ${resolved}`);
  return readDataUrl(resolved);
}

async function findProjectByName(ctx: CliContext, name: string) {
  const projects = await apiPost<ProjectItem[]>(ctx, "/api/project/getProject", {});
  return projects.find((project) => project.name === name);
}

async function findScriptByName(ctx: CliContext, projectId: number, name: string) {
  const scripts = await apiPost<ScriptItem[]>(ctx, "/api/script/getScrptApi", { projectId, name });
  return scripts.find((script) => script.name === name);
}

async function findAssetByName(ctx: CliContext, projectId: number, type: string, name: string) {
  const result = await apiPost<{ data: AssetListItem[]; total: number }>(ctx, "/api/assets/getAssetsApi", {
    projectId,
    type,
    name,
    page: 1,
    limit: 50,
  });
  return result.data.find((asset) => asset.name === name);
}

async function uploadNamedAsset(ctx: CliContext, projectId: number, type: string, name: string, imagePath: string) {
  await apiPost<string>(ctx, "/api/assets/uploadClip", {
    projectId,
    type,
    name,
    base64Data: await loadImageAsDataUrl(imagePath),
  });
  const asset = await findAssetByName(ctx, projectId, type, name);
  if (!asset?.id) fail(`上传后未找到资产: ${name}`);
  return asset;
}

function compactText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function buildColdOpenPrompt(scriptContent: string) {
  const scene = compactText(scriptContent.match(/\*\*镜头 1[\s\S]*?(?=\n\*\*镜头 2)/)?.[0] || scriptContent, 220);
  return [
    "竖屏写实职场短剧，电影级真实质感，冷白办公室灯光，轻微手持镜头。",
    "画面以梁平为唯一清晰人物：35岁中国男性，长方瘦削脸，发际线偏高，黑短发微乱，深灰格子衬衫，公司工牌，疲惫但警觉。",
    "动作：钢笔悬停在验收单签字栏上，纸面只保留模糊表格线和少量不可读小字，他迟疑、手指僵住，随后缓慢抬头看向玻璃会议室里几位模糊领导剪影。",
    "情绪：被突然推到责任中心，压抑、克制、意识到不对劲。",
    "严禁画面底部字幕、对白字幕、标题字、水印、UI叠字、海报文字；不要卡通，不要夸张表情，不要畸形手指，不要明显AI塑料感。",
    `参考分镜摘要：签字栏、空白签名线、领导隔着玻璃观察、主角迟疑抬头。${scene}`,
  ].join("\n");
}

async function commandCreateLtxMsrSample(ctx: CliContext, options: Record<string, string | boolean>) {
  const scriptPath = path.resolve(requireString(options, "scriptPath"));
  const assetMapPath = path.resolve(requireString(options, "assetMap"));
  const assetsDir = path.resolve(requireString(options, "assetsDir"));
  const backgroundImage = path.resolve(requireString(options, "backgroundImage"));
  const duration = optionalNumber(options, "duration") ?? 8;
  if (duration < 4 || duration > 20) fail("--duration 需要在 4 到 20 秒之间");

  const scriptContent = await fs.readFile(scriptPath, "utf-8");
  const assetMap = JSON.parse(await fs.readFile(assetMapPath, "utf-8")) as { characters?: { name_cn: string; image_path: string }[] };
  const characters = (assetMap.characters || []).slice(0, 4);
  if (characters.length < 1) fail("角色资产表至少需要 1 个角色");

  const projectName = `LTX2.3-MSR样片-${timestampForPath()}`;
  await apiPost<{ message: string }>(ctx, "/api/project/addProject", {
    projectType: "video",
    name: projectName,
    intro: "Codex 自动创建的 LTX-2.3 Licon-MSR 多参考样片工程",
    type: "短剧样片",
    artStyle: "写实职场短剧",
    directorManual: "竖屏写实，冷白办公室灯光，真实中国职场环境，人物一致性优先。",
    videoRatio: "9:16",
    imageModel: "",
    videoModel: LTX_MSR_MODEL,
    imageQuality: "720p",
    mode: JSON.stringify(LTX_MSR_MODE),
  });

  const project = await findProjectByName(ctx, projectName);
  if (!project?.id) fail(`新增项目后未找到项目: ${projectName}`);

  const uploadedRefs: AssetListItem[] = [];
  for (const character of characters) {
    const imagePath = path.resolve(assetsDir, character.image_path.replace(/^\.\//, ""));
    uploadedRefs.push(await uploadNamedAsset(ctx, project.id, "role", `MSR参考-${character.name_cn}`, imagePath));
  }
  const background = await uploadNamedAsset(ctx, project.id, "scene", "MSR背景-玻璃会议室签字栏", backgroundImage);

  const scriptName = "冷开场_LTX_MSR_样片";
  await apiPost<{ message: string }>(ctx, "/api/script/addScript", {
    name: scriptName,
    content: scriptContent,
    projectId: project.id,
    assets: uploadedRefs.map((asset) => asset.id),
  });
  const script = await findScriptByName(ctx, project.id, scriptName);
  if (!script?.id) fail(`新增剧本后未找到剧本: ${scriptName}`);

  const prompt = buildColdOpenPrompt(scriptContent);
  const storyboardList = await apiPost<StoryboardItem[]>(ctx, "/api/production/storyboard/batchAddStoryboardInfo", {
    projectId: project.id,
    scriptId: script.id,
    data: [
      {
        prompt,
        duration,
        track: "冷开场-签字栏",
        state: "已完成",
        src: null,
        videoDesc: "梁平在验收单签字栏前迟疑，随后抬头看向玻璃会议室里的领导剪影。",
        shouldGenerateImage: 1,
        associateAssetsIds: uploadedRefs.map((asset) => asset.id),
      },
    ],
  });
  const initialStoryboard = storyboardList[0];
  if (!initialStoryboard?.id) fail("新增分镜后未返回 storyboardId");
  const generateData = await apiPost<GenerateData>(ctx, "/api/production/workbench/getGenerateData", {
    projectId: project.id,
    scriptId: script.id,
  });
  const storyboard = generateData.storyboardList.find((item) => item.id === initialStoryboard.id) || initialStoryboard;
  const fallbackTrackId = generateData.trackList.length === 1 ? generateData.trackList[0].id : undefined;
  const trackId = storyboard.trackId || fallbackTrackId;
  if (!trackId) fail("新增分镜后未查询到 trackId");

  if (!background.src) fail("背景资产缺少可访问 URL");
  await apiPost<{ message: string }>(ctx, "/api/production/storyboard/updateStoryboardUrl", {
    id: storyboard.id,
    url: background.src,
    flowId: 0,
  });
  await apiPost<string>(ctx, "/api/production/workbench/updateVideoPrompt", {
    id: trackId,
    prompt,
  });

  const data = await apiPost<RegenerateVideoResult>(ctx, "/api/production/workbench/regenerateVideo", {
    projectId: project.id,
    scriptId: script.id,
    trackId,
    model: LTX_MSR_MODEL,
    mode: LTX_MSR_MODE,
    resolution: optionalString(options, "resolution") || "720p",
    duration,
    audio: false,
    autoSelect: true,
    regeneratePrompt: false,
  });

  if (!booleanOption(options, "poll")) {
    output({ projectId: project.id, scriptId: script.id, storyboardId: storyboard.id, ...data });
    return;
  }

  const timeoutMs = optionalNumber(options, "timeoutMs") ?? 900000;
  const intervalMs = optionalNumber(options, "intervalMs") ?? 8000;
  const pollResult = await pollVideos(ctx, project.id, script.id, [data.videoId], timeoutMs, intervalMs);
  output({ projectId: project.id, scriptId: script.id, storyboardId: storyboard.id, ...data, poll: pollResult });
  if (!pollResult.done) process.exitCode = 1;
}

async function commandImportPromptPackage(ctx: CliContext, options: Record<string, string | boolean>) {
  const packageDir = path.resolve(requireString(options, "packageDir"));
  const manifestPath = safeJoin(packageDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as PromptPackageManifest;

  if (manifest.packageType !== "toonflow-image-prompt-package") {
    fail(`manifest.packageType 不匹配: ${manifest.packageType}`);
  }
  if (!Number.isFinite(manifest.projectId)) {
    fail("manifest.projectId 必须是数字");
  }
  if (!Array.isArray(manifest.items)) {
    fail("manifest.items 必须是数组");
  }
  for (const item of manifest.items) {
    if (item.kind !== "asset" && item.kind !== "storyboard") fail(`manifest item kind 不支持: ${String(item.kind)}`);
    if (!Number.isFinite(item.id)) fail(`manifest item id 必须是数字: ${String(item.id)}`);
    if (!item.suggestedOutput) fail(`manifest item 缺少 suggestedOutput: ${item.kind}:${item.id}`);
  }

  const missing: string[] = [];
  for (const item of manifest.items) {
    const outputPath = safeJoin(packageDir, item.suggestedOutput);
    if (!(await fileExists(outputPath))) missing.push(item.suggestedOutput);
  }
  if (missing.length) {
    fail(`缺少输出图片:\n${missing.join("\n")}`);
  }

  const items = await Promise.all(
    manifest.items.map(async (item) => {
      const outputPath = safeJoin(packageDir, item.suggestedOutput);
      return {
        kind: item.kind,
        id: item.id,
        fileName: path.basename(item.suggestedOutput),
        resolution: item.size || "",
        base64Data: await readDataUrl(outputPath),
      };
    }),
  );

  const data = await apiPost<ImportPromptPackageResult>(ctx, "/api/promptPackage/import", {
    projectId: manifest.projectId,
    scriptId: manifest.scriptId ?? null,
    source: optionalString(options, "source") || "codex-imagegen-manual",
    items,
  });
  output({
    projectId: manifest.projectId,
    scriptId: manifest.scriptId ?? null,
    importedCount: data.imported?.length ?? 0,
    failedCount: data.failed?.length ?? 0,
    result: data,
  });
}

async function commandGetVideoTracks(ctx: CliContext, options: Record<string, string | boolean>) {
  const projectId = requireNumber(options, "projectId");
  const scriptId = requireNumber(options, "scriptId");
  const data = await apiPost<unknown>(ctx, "/api/production/workbench/getGenerateData", {
    projectId,
    scriptId,
  });
  if (!isRecord(data) || !Array.isArray(data.storyboardList) || !Array.isArray(data.trackList)) {
    output({
      projectId,
      scriptId,
      storyboardCount: 0,
      trackCount: 0,
      storyboardList: [],
      trackList: [],
      message: typeof data === "string" ? data : "视频轨道数据不可用",
      raw: data,
    });
    return;
  }

  output({
    projectId,
    scriptId,
    storyboardCount: data.storyboardList.length,
    trackCount: data.trackList.length,
    ...data,
  });
}

async function pollVideos(
  ctx: CliContext,
  projectId: number,
  scriptId: number,
  videoIds: number[],
  timeoutMs: number,
  intervalMs: number,
) {
  const startedAt = Date.now();
  const completed = new Map<number, VideoState>();
  const targetIds = [...new Set(videoIds)];

  while (Date.now() - startedAt <= timeoutMs) {
    const data = await apiPost<VideoState[]>(ctx, "/api/production/workbench/checkVideoStateList", {
      projectId,
      scriptId,
      videoIds: targetIds,
    });
    if (!Array.isArray(data)) fail("视频轮询接口返回的数据不是数组");
    for (const item of data) completed.set(item.id, item);

    const pendingIds = targetIds.filter((id) => !completed.has(id));
    if (!pendingIds.length) {
      return {
        done: true,
        elapsedMs: Date.now() - startedAt,
        videos: targetIds.map((id) => completed.get(id)),
        pendingIds,
      };
    }

    log(ctx, `Waiting for videos: ${pendingIds.join(", ")}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const pendingIds = targetIds.filter((id) => !completed.has(id));
  return {
    done: false,
    elapsedMs: Date.now() - startedAt,
    videos: targetIds.map((id) => completed.get(id)).filter(Boolean),
    pendingIds,
  };
}

async function commandPollVideos(ctx: CliContext, options: Record<string, string | boolean>) {
  const projectId = requireNumber(options, "projectId");
  const scriptId = requireNumber(options, "scriptId");
  const videoIds = parseNumberList(requireString(options, "videoIds"));
  const timeoutMs = optionalNumber(options, "timeoutMs") ?? 600000;
  const intervalMs = optionalNumber(options, "intervalMs") ?? 5000;
  if (timeoutMs < 0) fail("--timeout-ms 不能小于 0");
  if (intervalMs <= 0) fail("--interval-ms 必须大于 0");
  const result = await pollVideos(ctx, projectId, scriptId, videoIds, timeoutMs, intervalMs);
  output(result);
  if (!result.done) process.exitCode = 1;
}

async function commandRegenerateVideo(ctx: CliContext, options: Record<string, string | boolean>) {
  const projectId = requireNumber(options, "projectId");
  const scriptId = requireNumber(options, "scriptId");
  const trackId = requireNumber(options, "trackId");
  const model = requireString(options, "model");
  const mode = parseMode(requireString(options, "mode"));
  const resolution = requireString(options, "resolution");
  const duration = optionalNumber(options, "duration");
  const timeoutMs = optionalNumber(options, "timeoutMs") ?? 600000;
  const intervalMs = optionalNumber(options, "intervalMs") ?? 5000;
  if (timeoutMs < 0) fail("--timeout-ms 不能小于 0");
  if (intervalMs <= 0) fail("--interval-ms 必须大于 0");

  const data = await apiPost<RegenerateVideoResult>(ctx, "/api/production/workbench/regenerateVideo", {
    projectId,
    scriptId,
    trackId,
    model,
    mode,
    resolution,
    ...(duration != null ? { duration } : {}),
    audio: booleanOption(options, "audio"),
    autoSelect: booleanOption(options, "autoSelect"),
    regeneratePrompt: booleanOption(options, "regeneratePrompt", true),
  });

  if (!booleanOption(options, "poll")) {
    output(data);
    return;
  }

  const pollResult = await pollVideos(ctx, projectId, scriptId, [data.videoId], timeoutMs, intervalMs);
  output({ ...data, poll: pollResult });
  if (!pollResult.done) process.exitCode = 1;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "help" || booleanOption(options, "help")) {
    console.log(usage);
    return;
  }

  const ctx = createContext(options);

  switch (command) {
    case "login":
      await commandLogin(ctx);
      break;
    case "configure-runninghub":
      await commandConfigureRunningHub(ctx, options);
      break;
    case "create-ltx-msr-sample":
      await commandCreateLtxMsrSample(ctx, options);
      break;
    case "get-projects":
      await commandGetProjects(ctx);
      break;
    case "get-scripts":
      await commandGetScripts(ctx, options);
      break;
    case "export-prompt-package":
      await commandExportPromptPackage(ctx, options);
      break;
    case "import-prompt-package":
      await commandImportPromptPackage(ctx, options);
      break;
    case "get-video-tracks":
      await commandGetVideoTracks(ctx, options);
      break;
    case "regenerate-video":
      await commandRegenerateVideo(ctx, options);
      break;
    case "poll-videos":
      await commandPollVideos(ctx, options);
      break;
    default:
      fail(`未知命令: ${command}\n\n${usage}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
