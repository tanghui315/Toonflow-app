# RunningHub 中文站 LTX-2.3 Licon-MSR Workflow 接入

## 选型结论

`（高帧率）Ltx2.3 Licon-MSR全能参考生视频正式版V1` 更适合作为 Toonflow 的默认 RunningHub 中文站 LTX-2.3 多参考入口。

原因：

- MSR 面向多主体/多参考一致性，比“双角色”更通用。
- 工作流实际暴露 `image1`、`image2`、`image3`、`image4`、`背景图`，适合 Toonflow 的角色、场景、道具、分镜图组合。
- 它不像“数字人多图参考版”那样默认偏数字人，也不像“双角色”那样默认限定两个角色。

已接入的模型入口：

```text
runninghub:ltx-2.3/cn-msr-workflow
```

它和通用入口：

```text
runninghub:ltx-2.3/workflow
```

共用同一套 Workflow API 调用逻辑。区别是：

- `ltx-2.3/cn-msr-workflow`：产品化默认入口，限制 `imageReference:4` + `backgroundImage:1`。
- `ltx-2.3/workflow`：高级自定义入口，可继续承载首尾帧、多图、音频参考、视频参考等复杂工作流。

## 可选工作流候选

### 推荐：Licon-MSR 正式版 V1

RunningHub 中文站的 `（高帧率）Ltx2.3 Licon-MSR全能参考生视频正式版V1` 是当前推荐方案。

页面：

```text
https://www.runninghub.cn/post/2063444223206191106
```

公开 AI 应用：

```text
https://www.runninghub.cn/ai-detail/2064024424617168898
```

Toonflow 已内置这个工作流的默认 `workflowId` 和节点映射。直接选择 `runninghub:ltx-2.3/cn-msr-workflow` 时可以不填 `workflowId` / `workflowNodeMapJson`。

如果你把工作流复制到自己的 RunningHub 账号并改过节点，再用供应商配置里的 `workflowId` 和 `workflowNodeMapJson` 覆盖默认值。

已从公开接口拉到的 AI 应用参数：

| 输入 | nodeId | fieldName |
| --- | --- | --- |
| image1 | `29` | `image` |
| image2 | `40` | `image` |
| image3 | `30` | `image` |
| image4 | `84` | `image` |
| 背景图 | `33` | `image` |
| 宽 | `87` | `value` |
| 高 | `86` | `value` |
| 时长（秒） | `88` | `value` |
| prompt | `83` | `prompt` |

### 备选：多图 + 音频偏数字人

RunningHub 中文站有 `ltx-2.3-数字人-多图参考版`。

```text
https://www.runninghub.cn/post/2038885933809930241
```

它支持上传音频、设置音频起始时间/持续时间、上传多张图、设置每张图片的视频时长，并通过开关控制图片是否生效。缺点是定位偏“数字人”，不一定适合所有短剧镜头。

### 备选：双角色一致性

RunningHub 中文站有 `LTX-2.3_双角色设定集参考 + 自定义音频 视频生成工作流`。

页面：

```text
https://www.runninghub.cn/post/2064203596383735809
```

它适合双主角对话、双角色设定集一致性场景。缺点是默认假设“双角色”，对单角色、群像、场景/道具主导镜头不够通用。

## 运行前必须配置

在 Toonflow 的 RunningHub 供应商配置里填：

```text
baseUrl = https://www.runninghub.cn
workflowId = 可选；cn-msr-workflow 已内置 2064002512151212034
workflowNodeMapJson = 可选；cn-msr-workflow 已内置节点映射
```

注意：

- `post/...` 页面 ID 不是 `workflowId`。
- 如果使用 Toonflow 内置的 `cn-msr-workflow` 默认配置，不需要手动复制工作流。
- 如果使用你复制后修改过的版本，建议先在 RunningHub 网页手动成功跑一次，再导出/查看 API JSON。

## workflowNodeMapJson 支持的键

`cn-msr-workflow` 已内置下面这组最小映射；只有复制/改造工作流后才需要手动填写。

基础键：

```json
{
  "prompt": { "nodeId": "83", "fieldName": "prompt" },
  "duration": { "nodeId": "88", "fieldName": "value" },
  "width": { "nodeId": "87", "fieldName": "value" },
  "height": { "nodeId": "86", "fieldName": "value" }
}
```

图片输入：

```json
{
  "singleImage": { "nodeId": "30", "fieldName": "image" },
  "startImage": { "nodeId": "31", "fieldName": "image" },
  "endImage": { "nodeId": "32", "fieldName": "image" },
  "referenceImages": [
    { "nodeId": "29", "fieldName": "image" },
    { "nodeId": "40", "fieldName": "image" },
    { "nodeId": "30", "fieldName": "image" },
    { "nodeId": "84", "fieldName": "image" }
  ],
  "backgroundImage": { "nodeId": "33", "fieldName": "image" }
}
```

对 `Ltx2.3 Licon-MSR-全能参考生视频正式版V1-自动提示词版-高帧率-高动态`，最小可用映射可以从这里开始：

```json
{
  "prompt": { "nodeId": "83", "fieldName": "prompt" },
  "duration": { "nodeId": "88", "fieldName": "value" },
  "width": { "nodeId": "87", "fieldName": "value" },
  "height": { "nodeId": "86", "fieldName": "value" },
  "referenceImages": [
    { "nodeId": "29", "fieldName": "image" },
    { "nodeId": "40", "fieldName": "image" },
    { "nodeId": "30", "fieldName": "image" },
    { "nodeId": "84", "fieldName": "image" }
  ],
  "backgroundImage": { "nodeId": "33", "fieldName": "image" }
}
```

图片启用、时长、起始时间：

```json
{
  "referenceImageEnables": [
    { "nodeId": "50", "fieldName": "value" },
    { "nodeId": "51", "fieldName": "value" }
  ],
  "referenceImageDurations": [
    { "nodeId": "60", "fieldName": "value" },
    { "nodeId": "61", "fieldName": "value" }
  ],
  "referenceImageStartTimes": [
    { "nodeId": "70", "fieldName": "value" },
    { "nodeId": "71", "fieldName": "value" }
  ]
}
```

音频输入：

```json
{
  "audioReferences": [
    { "nodeId": "80", "fieldName": "audio" }
  ],
  "audioReferenceEnables": [
    { "nodeId": "81", "fieldName": "value" }
  ],
  "audioReferenceDurations": [
    { "nodeId": "82", "fieldName": "value" }
  ],
  "audioReferenceStartTimes": [
    { "nodeId": "83", "fieldName": "value" }
  ]
}
```

视频输入：

```json
{
  "videoReferences": [
    { "nodeId": "90", "fieldName": "video" }
  ],
  "videoReferenceEnables": [
    { "nodeId": "91", "fieldName": "value" }
  ],
  "videoReferenceDurations": [
    { "nodeId": "92", "fieldName": "value" }
  ],
  "videoReferenceStartTimes": [
    { "nodeId": "93", "fieldName": "value" }
  ]
}
```

静态节点：

```json
{
  "static": [
    { "nodeId": "100", "fieldName": "seed", "fieldValue": -1 },
    { "nodeId": "101", "fieldName": "value", "fieldValue": true }
  ]
}
```

`static` 适合写死 seed、steps、cfg、开关、采样器等不会由 Toonflow 动态决定的参数。

## 字段填充值规则

- `prompt` 使用 Toonflow 生成的视频提示词。
- `duration` 使用当前视频片段时长。
- `width` / `height` 根据项目比例和分辨率自动计算。
- `referenceImages` 使用 Toonflow 的角色、道具、关键视觉参考；MSR 入口最多使用前 4 张。
- `backgroundImage` 使用第 5 张图片，建议传场景图或当前分镜图。
- 片段重生成时会优先把资产图放入前 4 个参考槽，并把分镜图提前到背景槽；如果图片不足 5 张，背景槽会复用最后一张可用图片。
- `audioReferences` 使用 Toonflow 绑定到角色/资产的音频引用。
- `referenceImageEnables` 自动填 `true`。
- `referenceImageDurations` 自动填当前片段时长。
- `referenceImageStartTimes` 自动填 `0`。
- 音频/视频引用的 enable、duration、startTime 同理。

## 推荐调用

```bash
yarn toonflow:codex regenerate-video \
  --project-id 1 \
  --script-id 1 \
  --track-id 1 \
  --model runninghub:ltx-2.3/cn-msr-workflow \
  --mode '["imageReference:4","backgroundImage:1"]' \
  --resolution 720p \
  --duration 5 \
  --poll \
  --no-auto-select \
  --json
```

## 接入检查

1. 在 RunningHub 中文站选择一个 LTX-2.3 多资源工作流。
2. 复制到自己的账号。
3. 手动运行一次，确认能成功出视频。
4. 导出/查看该工作流的 API JSON。
5. 从 API JSON 中找到 prompt、图片、音频、时长、宽高等节点的 `nodeId` 和 `fieldName`。
6. 填写 Toonflow RunningHub 配置。
7. 用一个 1 条视频片段的小项目测试。

如果 `workflowNodeMapJson` 没有生成任何 `nodeInfoList`，Toonflow 会拒绝提交，避免错误扣费。
