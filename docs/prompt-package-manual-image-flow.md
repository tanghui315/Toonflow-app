# Prompt Package Manual Image Flow

## Purpose

This flow lets Toonflow export image generation prompts, generate images outside the built-in image vendors, then import the finished images back into the project.

The first target is manual Codex/ChatGPT image generation, but the API is vendor-neutral.

## Export

Endpoint:

```http
POST /api/promptPackage/export
```

Body:

```json
{
  "projectId": 1,
  "scriptId": 2,
  "assetIds": [101, 102],
  "storyboardIds": [201, 202],
  "includeAssets": true,
  "includeStoryboards": true,
  "includeReferences": true,
  "asZip": true
}
```

Response data contains:

- `manifest`: stable item mapping.
- `files`: `manifest.json`, prompt files, and `codex-batch.md` as text.
- `referenceFiles`: existing asset image references included in the zip when available.
- `zip`: `{ zipPath, zipUrl }` when `asZip` is true.

When `assetIds` is omitted and `includeAssets` is not false, all project role/scene/tool assets are exported.

When neither `scriptId` nor `storyboardIds` is provided, no storyboard prompts are exported.

## Package Layout

```text
toonflow-prompt-package.zip
├── manifest.json
├── codex-batch.md
├── prompts/
│   ├── asset-101-role-name.md
│   └── storyboard-201-storyboard.md
├── references/
│   └── asset-101-name.jpg
└── outputs/
    └── .gitkeep
```

Generate images from each prompt and save them using the exact `suggestedOutput` path in `manifest.json`, for example:

```text
outputs/asset-101-role-name.png
outputs/storyboard-201-storyboard.png
```

## Import

Endpoint:

```http
POST /api/promptPackage/import
```

Body:

```json
{
  "projectId": 1,
  "scriptId": 2,
  "source": "codex-imagegen-manual",
  "items": [
    {
      "kind": "asset",
      "id": 101,
      "fileName": "asset-101-role-name.png",
      "base64Data": "data:image/png;base64,..."
    },
    {
      "kind": "storyboard",
      "id": 201,
      "fileName": "storyboard-201-storyboard.png",
      "base64Data": "data:image/png;base64,..."
    }
  ]
}
```

Supported image formats:

- `jpg`
- `png`
- `webp`

Import behavior:

- Asset image: writes the file to OSS, inserts `o_image`, and updates `o_assets.imageId`.
- Storyboard image: writes the file to OSS and updates `o_storyboard.filePath`, `state`, and `shouldGenerateImage`.

The import API returns both `imported` and `failed`. One failed image does not block the whole batch unless every item fails.

## Local Import Helper

After extracting the zip and placing generated images in `outputs/`, run:

```bash
tsx scripts/importPromptPackageOutputs.ts /path/to/toonflow-prompt-package http://localhost:10588
```

The helper reads `manifest.json`, converts each `suggestedOutput` image to base64, and posts to `/api/promptPackage/import`.
