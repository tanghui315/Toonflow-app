type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel)[];
}

type ReferenceList = { type: "image"; sourceType?: "base64"; base64: string } | { type: "audio"; sourceType?: "base64"; base64: string } | { type: "video"; sourceType?: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode | VideoMode[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

declare const axios: any;
declare const FormData: any;
declare const Buffer: any;
declare const logger: (msg: string) => void;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
};

const vendor: VendorConfig = {
  id: "runninghub",
  version: "1.1",
  author: "Toonflow",
  name: "RunningHub",
  description:
    "RunningHub 视频生成接口。当前内置 LTX-2.3 标准文生/图生视频，以及可配置 Workflow 通道，用于首尾帧、多参考图、音频参考等复杂工作流。需要在 RunningHub 获取 API Key。",
  inputs: [
    { key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "RunningHub API Key" },
    { key: "baseUrl", label: "接口地址", type: "url", required: true, placeholder: "https://www.runninghub.ai" },
    { key: "t2vLandscapeSelect", label: "T2V 横屏选项", type: "text", required: true, placeholder: "官方示例默认 2" },
    { key: "t2vPortraitSelect", label: "T2V 竖屏选项", type: "text", required: true, placeholder: "默认 1，可按后台选项调整" },
    { key: "i2vLandscapeSelect", label: "I2V 横屏选项", type: "text", required: true, placeholder: "官方示例默认 1" },
    { key: "i2vPortraitSelect", label: "I2V 竖屏选项", type: "text", required: true, placeholder: "默认 2，可按后台选项调整" },
    { key: "qualitySelect", label: "质量/FPS选项", type: "text", required: true, placeholder: "官方示例默认 2" },
    { key: "rhCoinGuard", label: "RH币预检", type: "text", required: true, placeholder: "1=提交任务前检查RH币余额" },
    { key: "workflowId", label: "Workflow ID", type: "text", required: false, placeholder: "RunningHub LTX-2.3 工作流 ID" },
    { key: "workflowNodeMapJson", label: "Workflow节点映射", type: "text", required: false, placeholder: "{\"prompt\":{\"nodeId\":\"6\",\"fieldName\":\"text\"}}" },
    { key: "workflowInstanceType", label: "Workflow实例类型", type: "text", required: false, placeholder: "可选，留空使用RunningHub默认值" },
    { key: "workflowUsePersonalQueue", label: "个人队列", type: "text", required: false, placeholder: "1=使用个人队列，0=默认" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://www.runninghub.ai",
    t2vLandscapeSelect: "2",
    t2vPortraitSelect: "1",
    i2vLandscapeSelect: "1",
    i2vPortraitSelect: "2",
    qualitySelect: "2",
    rhCoinGuard: "1",
    workflowId: "",
    workflowNodeMapJson: "",
    workflowInstanceType: "",
    workflowUsePersonalQueue: "0",
  },
  models: [
    {
      name: "LTX-2.3 文生视频",
      modelName: "ltx-2.3/text-to-video",
      type: "video",
      mode: ["text"],
      audio: true,
      durationResolutionMap: [{ duration: [5, 6, 7, 8, 9, 10, 15, 20], resolution: ["1080p"] }],
    },
    {
      name: "LTX-2.3 图生视频",
      modelName: "ltx-2.3/image-to-video",
      type: "video",
      mode: ["singleImage"],
      audio: true,
      durationResolutionMap: [{ duration: [5, 6, 7, 8, 9, 10, 15, 20], resolution: ["1080p"] }],
    },
    {
      name: "LTX-2.3 Workflow 可配置",
      modelName: "ltx-2.3/workflow",
      type: "video",
      mode: ["text", "singleImage", "startFrameOptional", "startEndRequired", ["imageReference:9", "audioReference:3", "videoReference:1"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20], resolution: ["480p", "720p", "1080p"] }],
    },
  ],
};
exports.vendor = vendor;

const textRequest = () => {
  throw new Error("RunningHub 渠道当前仅提供视频模型");
};
exports.textRequest = textRequest;

const imageRequest = async () => {
  throw new Error("RunningHub 渠道当前仅提供视频模型");
};
exports.imageRequest = imageRequest;

function baseUrl() {
  return (vendor.inputValues.baseUrl || "https://www.runninghub.ai").replace(/\/+$/, "");
}

function apiKey() {
  const value = vendor.inputValues.apiKey || "";
  if (!value) throw new Error("缺少 RunningHub API Key");
  return value.replace(/^Bearer\s+/i, "");
}

function headers(contentType = "application/json") {
  return {
    Authorization: `Bearer ${apiKey()}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function isFailureCode(value: any) {
  if (value === undefined || value === null || value === "") return false;
  const code = Number(value);
  if (Number.isFinite(code)) return code !== 0 && code !== 200;
  return true;
}

function hasFailureCode(data: any) {
  return isFailureCode(data?.errorCode) || isFailureCode(data?.code);
}

function responseMessage(data: any, fallback: string) {
  return data?.errorMessage || data?.message || data?.msg || fallback;
}

function toInteger(value: number, fallback: number, min = 5, max = 20) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

async function getAccountStatus() {
  const response = await axios.post(
    `${baseUrl()}/uc/openapi/accountStatus`,
    { apikey: apiKey() },
    { headers: headers() },
  );
  const data = response.data?.data;
  if (!data) throw new Error(`RunningHub 账号状态查询失败: ${JSON.stringify(response.data)}`);
  return data;
}

async function ensureRhCoins() {
  if (vendor.inputValues.rhCoinGuard === "0") return null;
  const data = await getAccountStatus();
  const coins = Number(data.remainCoins);
  if (!Number.isFinite(coins)) throw new Error(`RunningHub 未返回 RH币余额: ${JSON.stringify(data)}`);
  if (coins <= 0) throw new Error("RunningHub RH币余额不足，已阻止提交视频任务");
  logger({
    runninghubAccount: {
      remainCoins: data.remainCoins,
      currentTaskCounts: data.currentTaskCounts,
      apiType: data.apiType,
    },
  });
  return coins;
}

function firstImage(config: VideoConfig) {
  return (config.referenceList || []).find((item) => item.type === "image") as Extract<ReferenceList, { type: "image" }> | undefined;
}

function parseBase64File(dataUrl: string, fallbackMime = "application/octet-stream") {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const mime = match?.[1] || fallbackMime;
  const rawBase64 = match?.[2] || dataUrl;
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
  };
  const ext = extMap[mime] || mime.split("/")[1] || "bin";
  return { buffer: Buffer.from(rawBase64, "base64"), mime, ext };
}

async function uploadImage(imageBase64: string) {
  const file = parseBase64File(imageBase64, "image/png");
  const form = new FormData();
  form.append("file", file.buffer, {
    filename: `toonflow-reference.${file.ext}`,
    contentType: file.mime,
  });

  const response = await axios.post(`${baseUrl()}/openapi/v2/media/upload/binary`, form, {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
  });
  if (hasFailureCode(response.data)) {
    throw new Error(responseMessage(response.data, "RunningHub 图片上传失败"));
  }
  const filename = response.data?.data?.filename || response.data?.data?.fileName;
  if (!filename) throw new Error(`RunningHub 图片上传未返回 filename: ${JSON.stringify(response.data)}`);
  return filename;
}

function workflowId() {
  const value = (vendor.inputValues.workflowId || "").trim();
  if (!value) throw new Error("缺少 RunningHub Workflow ID。请先复制 LTX-2.3 工作流并填写 workflowId");
  return value;
}

function parseNodeMap() {
  const raw = (vendor.inputValues.workflowNodeMapJson || "").trim();
  if (!raw) throw new Error("缺少 RunningHub Workflow 节点映射 JSON。请从 Workflow API JSON 中配置 nodeId/fieldName");
  try {
    return JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Workflow节点映射不是合法JSON: ${e?.message || String(e)}`);
  }
}

function asArray(value: any): any[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function appendNode(nodeInfoList: any[], mapping: any, value?: any) {
  for (const item of asArray(mapping)) {
    if (!item?.nodeId || !item?.fieldName) continue;
    const fieldValue = value !== undefined ? value : item.fieldValue;
    if (fieldValue === undefined || fieldValue === null) continue;
    nodeInfoList.push({
      nodeId: String(item.nodeId),
      fieldName: String(item.fieldName),
      fieldValue,
    });
  }
}

function appendNodeSequence(nodeInfoList: any[], mappings: any, values: any[]) {
  const mapList = asArray(mappings);
  for (let i = 0; i < mapList.length && i < values.length; i++) {
    appendNode(nodeInfoList, mapList[i], values[i]);
  }
}

function dimensions(aspectRatio: string, resolution: string) {
  const longSide = /1080/i.test(resolution) ? 1920 : /480/i.test(resolution) ? 854 : 1280;
  const shortSide = /1080/i.test(resolution) ? 1080 : /480/i.test(resolution) ? 480 : 720;
  if (aspectRatio === "9:16") return { width: shortSide, height: longSide };
  return { width: longSide, height: shortSide };
}

function activeMode(config: VideoConfig) {
  return Array.isArray(config.mode) ? config.mode : String(config.mode || "text");
}

function shouldReserveStartEnd(config: VideoConfig) {
  const mode = activeMode(config);
  return mode === "startEndRequired" || mode === "endFrameOptional";
}

function shouldReserveStart(config: VideoConfig) {
  const mode = activeMode(config);
  return mode === "singleImage" || mode === "startFrameOptional" || mode === "startEndRequired" || mode === "endFrameOptional";
}

async function uploadWorkflowFile(ref: ReferenceList) {
  const fallbackMimeMap: Record<string, string> = { image: "image/png", audio: "audio/wav", video: "video/mp4" };
  const file = parseBase64File(ref.base64, fallbackMimeMap[ref.type]);
  const form = new FormData();
  form.append("file", file.buffer, {
    filename: `toonflow-${ref.type}.${file.ext}`,
    contentType: file.mime,
  });

  const response = await axios.post(`${baseUrl()}/openapi/v2/media/upload/binary`, form, {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...form.getHeaders(),
    },
    maxBodyLength: Infinity,
  });
  if (hasFailureCode(response.data)) {
    throw new Error(responseMessage(response.data, `RunningHub ${ref.type}上传失败`));
  }
  const data = response.data?.data || response.data;
  const filename = data?.fileName || data?.filename || data?.file_name || data?.name;
  if (!filename) throw new Error(`RunningHub Workflow文件上传未返回 fileName: ${JSON.stringify(response.data)}`);
  return filename;
}

async function buildWorkflowNodeInfoList(config: VideoConfig) {
  const map = parseNodeMap();
  const nodeInfoList: any[] = [];
  const size = dimensions(config.aspectRatio, config.resolution || "720p");
  const duration = toInteger(config.duration, 5, 1, 60);
  const images = (config.referenceList || []).filter((ref) => ref.type === "image") as Extract<ReferenceList, { type: "image" }>[];
  const audios = (config.referenceList || []).filter((ref) => ref.type === "audio") as Extract<ReferenceList, { type: "audio" }>[];
  const videos = (config.referenceList || []).filter((ref) => ref.type === "video") as Extract<ReferenceList, { type: "video" }>[];
  const [imageFiles, audioFiles, videoFiles] = await Promise.all([
    Promise.all(images.map((ref) => uploadWorkflowFile(ref))),
    Promise.all(audios.map((ref) => uploadWorkflowFile(ref))),
    Promise.all(videos.map((ref) => uploadWorkflowFile(ref))),
  ]);

  appendNode(nodeInfoList, map.prompt, config.prompt || "");
  appendNode(nodeInfoList, map.duration, duration);
  appendNode(nodeInfoList, map.resolution, config.resolution || "720p");
  appendNode(nodeInfoList, map.aspectRatio, config.aspectRatio);
  appendNode(nodeInfoList, map.width, size.width);
  appendNode(nodeInfoList, map.height, size.height);
  appendNode(nodeInfoList, map.audio, config.audio !== false);

  if (map.static) {
    for (const item of asArray(map.static)) appendNode(nodeInfoList, item);
  }

  const mode = activeMode(config);
  if (mode === "singleImage") {
    if (!imageFiles[0]) throw new Error("Workflow 单图模式需要一张参考图");
    appendNode(nodeInfoList, map.singleImage || map.startImage, imageFiles[0]);
  } else if (mode === "startFrameOptional") {
    if (imageFiles[0]) appendNode(nodeInfoList, map.startImage || map.singleImage, imageFiles[0]);
  } else if (mode === "startEndRequired") {
    if (!imageFiles[0] || !imageFiles[1]) throw new Error("Workflow 首尾帧模式需要至少两张图片");
    appendNode(nodeInfoList, map.startImage || map.singleImage, imageFiles[0]);
    appendNode(nodeInfoList, map.endImage, imageFiles[1]);
  } else if (mode === "endFrameOptional") {
    if (imageFiles[0]) appendNode(nodeInfoList, map.startImage || map.singleImage, imageFiles[0]);
    if (imageFiles[1]) appendNode(nodeInfoList, map.endImage, imageFiles[1]);
  }

  let imageRefOffset = 0;
  if (Array.isArray(mode)) imageRefOffset = 0;
  else if (shouldReserveStartEnd(config)) imageRefOffset = 2;
  else if (shouldReserveStart(config)) imageRefOffset = 1;

  appendNodeSequence(nodeInfoList, map.referenceImages || map.images, imageFiles.slice(imageRefOffset));
  appendNodeSequence(nodeInfoList, map.audioReferences || map.audios, audioFiles);
  appendNodeSequence(nodeInfoList, map.videoReferences || map.videos, videoFiles);

  if (nodeInfoList.length === 0) throw new Error("Workflow 节点映射没有生成任何 nodeInfoList，请检查 workflowNodeMapJson");
  logger({ runninghubWorkflowNodes: nodeInfoList.map((item) => `${item.nodeId}.${item.fieldName}`) });
  return nodeInfoList;
}

function outputUrl(data: any) {
  const direct = findVideoUrl(data);
  if (direct) return direct;
  const results = data?.results || data?.data?.results || [];
  const result = results.find((item: any) => item?.outputType === "mp4" || String(item?.url || "").includes(".mp4")) || results[0];
  return result?.url || result?.download_url || result?.fileUrl;
}

async function pollVideo(taskId: string) {
  const result = await pollTask(
    async () => {
      const response = await axios.post(`${baseUrl()}/openapi/v2/query`, { taskId }, { headers: headers() });
      const data = response.data || {};
      const status = String(data.status || data.data?.status || "").toUpperCase();
      const url = outputUrl(data);
      if (url) return { completed: true, data: url };
      if (status === "SUCCESS" || status === "COMPLETED") {
        if (!url) return { completed: false, error: `RunningHub 任务成功但未返回视频地址: ${JSON.stringify(data)}` };
        return { completed: true, data: url };
      }
      if (status === "FAILED" || status === "CREATE_FAILED") {
        return { completed: false, error: responseMessage(data, "RunningHub 视频生成失败") };
      }
      return { completed: false };
    },
    5000,
    3000000,
  );
  if (!result.completed || !result.data) throw new Error(result.error || "RunningHub 视频生成超时");
  return result.data;
}

async function createTask(endpoint: string, body: Record<string, any>) {
  const beforeCoins = await ensureRhCoins();
  logger({ runninghubEndpoint: endpoint, bodyKeys: Object.keys(body) });
  const response = await axios.post(`${baseUrl()}${endpoint}`, body, { headers: headers() });
  const data = response.data || {};
  if (hasFailureCode(data)) {
    throw new Error(responseMessage(data, `RunningHub 提交失败: ${JSON.stringify(data)}`));
  }
  const taskId = data.taskId || data.data?.taskId;
  if (!taskId) throw new Error(`RunningHub 提交后未返回 taskId: ${JSON.stringify(data)}`);
  const url = await pollVideo(taskId);
  if (beforeCoins !== null) {
    try {
      const afterStatus = await getAccountStatus();
      const afterCoins = Number(afterStatus.remainCoins);
      if (Number.isFinite(afterCoins)) {
        logger({ runninghubBilling: { beforeCoins, afterCoins, consumedCoins: beforeCoins - afterCoins } });
      }
    } catch (e: any) {
      logger({ runninghubBillingError: e?.message || String(e) });
    }
  }
  return url;
}

function findVideoUrl(value: any): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value) && /\.(mp4|mov|webm)(\?|$)/i.test(value)) return value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    const direct = value.fileUrl || value.file_url || value.url || value.downloadUrl || value.download_url;
    const fileType = String(value.fileType || value.file_type || value.type || "").toLowerCase();
    if (
      typeof direct === "string" &&
      /^https?:\/\//.test(direct) &&
      (/\.(mp4|mov|webm)(\?|$)/i.test(direct) || /^(mp4|mov|webm|video)$/.test(fileType))
    ) {
      return direct;
    }
    for (const key of Object.keys(value)) {
      const found = findVideoUrl(value[key]);
      if (found) return found;
    }
  }
  return null;
}

async function readWorkflowOutputs(taskId: string) {
  const response = await axios.post(`${baseUrl()}/task/openapi/outputs`, { apiKey: apiKey(), taskId }, { headers: headers() });
  return response.data || {};
}

async function pollWorkflowTask(taskId: string) {
  const result = await pollTask(
    async () => {
      const data = await readWorkflowOutputs(taskId);
      const status = data.taskStatus || data.status || data.data?.taskStatus || data.data?.status;
      const url = findVideoUrl(data);
      if (url) return { completed: true, data: url };
      if (status === "SUCCESS" || status === "COMPLETED" || status === "completed" || status === "success") {
        return { completed: false, error: `RunningHub Workflow 任务成功但未找到视频输出: ${JSON.stringify(data)}` };
      }
      if (status === "FAILED" || status === "CREATE_FAILED" || status === "failed") {
        return { completed: false, error: data.errorMessage || data.message || data.data?.errorMessage || "RunningHub Workflow 任务失败" };
      }
      const code = Number(data.code);
      if (Number.isFinite(code) && code !== 0 && code !== 200) {
        const message = data.msg || data.message || data.errorMessage || "";
        if (/fail|error|失败/i.test(message)) return { completed: false, error: message };
      }
      return { completed: false };
    },
    5000,
    3000000,
  );
  if (!result.completed || !result.data) throw new Error(result.error || "RunningHub Workflow 任务超时");
  return result.data;
}

async function createWorkflowTask(config: VideoConfig) {
  const beforeCoins = await ensureRhCoins();
  const nodeInfoList = await buildWorkflowNodeInfoList(config);
  const body: Record<string, any> = {
    apiKey: apiKey(),
    workflowId: workflowId(),
    nodeInfoList,
  };
  if (vendor.inputValues.workflowInstanceType) body.instanceType = vendor.inputValues.workflowInstanceType;
  if (vendor.inputValues.workflowUsePersonalQueue === "1") body.usePersonalQueue = true;

  logger({ runninghubWorkflow: { workflowId: body.workflowId, nodeCount: nodeInfoList.length } });
  const response = await axios.post(`${baseUrl()}/task/openapi/create`, body, { headers: headers() });
  const data = response.data || {};
  if (hasFailureCode(data)) {
    throw new Error(responseMessage(data, `RunningHub Workflow 提交失败: ${JSON.stringify(data)}`));
  }
  const taskId = data.taskId || data.data?.taskId || data.data;
  if (!taskId) throw new Error(`RunningHub Workflow 提交后未返回 taskId: ${JSON.stringify(data)}`);
  const url = await pollWorkflowTask(String(taskId));

  if (beforeCoins !== null) {
    try {
      const afterStatus = await getAccountStatus();
      const afterCoins = Number(afterStatus.remainCoins);
      if (Number.isFinite(afterCoins)) {
        logger({ runninghubWorkflowBilling: { beforeCoins, afterCoins, consumedCoins: beforeCoins - afterCoins } });
      }
    } catch (e: any) {
      logger({ runninghubWorkflowBillingError: e?.message || String(e) });
    }
  }
  return url;
}

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const duration = toInteger(config.duration, 5);
  const prompt = config.prompt || "";
  const qualitySelect = vendor.inputValues.qualitySelect || "2";

  if (model.modelName === "ltx-2.3/workflow") {
    return createWorkflowTask(config);
  }

  if (model.modelName === "ltx-2.3/image-to-video") {
    const image = firstImage(config);
    if (!image?.base64) throw new Error("LTX-2.3 图生视频需要一张参考图");
    const filename = await uploadImage(image.base64);
    return createTask("/openapi/v2/rhart-video/ltx-2.3/image-to-video", {
      "98##image": filename,
      "200##prompt": prompt,
      "245##select": config.aspectRatio === "9:16" ? vendor.inputValues.i2vPortraitSelect : vendor.inputValues.i2vLandscapeSelect,
      "240##select": qualitySelect,
      "222##value": duration,
    });
  }

  return createTask("/openapi/v2/rhart-video/ltx-2.3/text-to-video", {
    "188##prompt": prompt,
    "247##select": config.aspectRatio === "9:16" ? vendor.inputValues.t2vPortraitSelect : vendor.inputValues.t2vLandscapeSelect,
    "248##select": qualitySelect,
    "227##value": duration,
  });
};
exports.videoRequest = videoRequest;
