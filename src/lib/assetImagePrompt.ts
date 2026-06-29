export type AssetType = "role" | "scene" | "tool";

export interface AssetTypeConfig {
  label: string;
  taskClass: string;
  dir: string;
  promptTitle: string;
  promptEnd: string;
}

export const assetTypeConfig: Record<AssetType, AssetTypeConfig> = {
  role: {
    label: "角色",
    taskClass: "角色图生成",
    dir: "role",
    promptTitle: "角色标准四视图",
    promptEnd: "人物角色四视图",
  },
  scene: {
    label: "场景",
    taskClass: "场景图生成",
    dir: "scene",
    promptTitle: "标准场景图",
    promptEnd: "标准场景图",
  },
  tool: {
    label: "道具",
    taskClass: "道具图生成",
    dir: "props",
    promptTitle: "标准道具图",
    promptEnd: "标准道具图",
  },
};

export function buildAssetImagePrompt(cfg: AssetTypeConfig, artStyle: string, name: string, prompt: string): string {
  return `
    请根据以下参数生成${cfg.promptTitle}：

    **基础参数：**
    - 画风风格: ${artStyle || "未指定"}

    **${cfg.label}设定：**
    - 名称:${name},
    - 提示词:${prompt},

    请严格按照系统规范生成${cfg.promptEnd}。
  `;
}
