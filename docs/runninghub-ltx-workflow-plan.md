# RunningHub LTX-2.3 Workflow 接入方案

## 目标

在现有 RunningHub 标准模型通道之外，新增一个可配置的 Workflow 视频模型，用于承载 LTX-2.3 工作流里的首尾帧、多参考图、角色一致性和音频参考能力。

标准模型 API 继续用于低门槛的文生视频和单图生视频；Workflow API 用于 Toonflow 生产链路更需要的复杂输入。

## 当前项目约束

Toonflow 的视频生成调用统一进入供应商脚本的 `videoRequest(config, model)`。上游已经能传入：

- `prompt`
- `duration`
- `resolution`
- `aspectRatio`
- `audio`
- `mode`
- `referenceList`，其中包含 image/audio/video base64

因此接入点只需要改 `data/vendor/runninghub.ts`，不需要改生产工作台主流程。

## 接入形态

RunningHub Workflow 通道新增一个内置视频模型：

- 名称：`LTX-2.3 Workflow 可配置`
- 模型名：`ltx-2.3/workflow`
- 模式：
  - `text`
  - `singleImage`
  - `startFrameOptional`
  - `startEndRequired`
  - `["imageReference:9", "audioReference:3", "videoReference:1"]`

供应商配置新增：

- `workflowId`：RunningHub workflow id
- `workflowNodeMapJson`：Toonflow 输入到工作流节点的映射
- `workflowInstanceType`：可选实例类型
- `workflowUsePersonalQueue`：是否走个人队列

## 节点映射格式

不同 RunningHub 工作流的节点编号不同，所以节点映射必须配置化。

```json
{
  "prompt": { "nodeId": "6", "fieldName": "text" },
  "negativePrompt": { "nodeId": "7", "fieldName": "text", "fieldValue": "blurry, watermark, subtitles" },
  "duration": { "nodeId": "20", "fieldName": "value" },
  "aspectRatio": { "nodeId": "21", "fieldName": "value" },
  "resolution": { "nodeId": "22", "fieldName": "value" },
  "startImage": { "nodeId": "14", "fieldName": "image" },
  "endImage": { "nodeId": "15", "fieldName": "image" },
  "referenceImages": [
    { "nodeId": "30", "fieldName": "image" },
    { "nodeId": "31", "fieldName": "image" }
  ],
  "audioReferences": [
    { "nodeId": "40", "fieldName": "audio" }
  ],
  "static": [
    { "nodeId": "3", "fieldName": "seed", "fieldValue": -1 }
  ]
}
```

字段规则：

- `prompt` 使用 Toonflow 生成的视频提示词。
- `startImage` 使用第一张 image reference。
- `endImage` 使用第二张 image reference。
- `singleImage` 未配置时复用 `startImage`。
- `referenceImages` 从剩余图片开始填充；如果没有首尾帧，默认从第一张图片开始。
- `audioReferences` 和 `videoReferences` 按顺序填充。
- `static` 用于写死 seed、steps、cfg 等工作流常量。

## 执行流程

1. 提交前查询 RunningHub 账号状态，确认 RH 币余额。
2. 将 Toonflow 的 base64 图片、音频、视频上传到 RunningHub 的 `/openapi/v2/media/upload/binary`，并把返回的 `fileName` 写入对应加载节点。
3. 根据 `workflowNodeMapJson` 生成 `nodeInfoList`。
4. 调用 RunningHub Workflow 创建任务接口。
5. 轮询任务状态和输出。
6. 返回 mp4 URL，继续复用 Toonflow 的保存逻辑。
7. 任务完成后再次查询 RH 币余额，记录本次消耗。

## 使用前置条件

需要先在 RunningHub 账号内选定或复制一个 LTX-2.3 工作流，并导出 Workflow API JSON，拿到真实 `workflowId` 和节点映射。

没有节点映射时，`ltx-2.3/workflow` 会拒绝提交，避免错误扣费。
