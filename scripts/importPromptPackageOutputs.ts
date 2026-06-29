import fs from "node:fs/promises";
import path from "node:path";

type ManifestItem = {
  kind: "asset" | "storyboard";
  id: number;
  suggestedOutput: string;
  size?: string;
};

type Manifest = {
  projectId: number;
  scriptId?: number | null;
  items: ManifestItem[];
};

const mimeByExt: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function readDataUrl(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = mimeByExt[ext];
  if (!mime) throw new Error(`不支持的图片格式: ${filePath}`);
  const buffer = await fs.readFile(filePath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function main() {
  const packageDir = process.argv[2];
  const baseUrl = (process.argv[3] || "http://localhost:10588").replace(/\/+$/, "");
  if (!packageDir) {
    throw new Error("用法: tsx scripts/importPromptPackageOutputs.ts <prompt-package-dir> [baseUrl]");
  }

  const manifestPath = path.join(packageDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as Manifest;
  const items = [];
  const missing = [];

  for (const item of manifest.items) {
    const filePath = path.join(packageDir, item.suggestedOutput);
    try {
      items.push({
        kind: item.kind,
        id: item.id,
        fileName: path.basename(item.suggestedOutput),
        resolution: item.size || "",
        base64Data: await readDataUrl(filePath),
      });
    } catch {
      missing.push(item.suggestedOutput);
    }
  }

  if (missing.length) {
    throw new Error(`缺少输出图片:\n${missing.join("\n")}`);
  }

  const response = await fetch(`${baseUrl}/api/promptPackage/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: manifest.projectId,
      scriptId: manifest.scriptId ?? null,
      source: "codex-imagegen-manual",
      items,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data, null, 2));
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
