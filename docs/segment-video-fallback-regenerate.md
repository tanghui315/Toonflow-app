# Segment Video Fallback Regenerate

## Goal

Support a product-level fallback workflow:

1. Generate most video segments with the project default model, such as RunningHub LTX-2.3.
2. Review each segment in the video candidate list.
3. If one segment is unsatisfactory, regenerate only that segment with another model, such as Seedance 2.0.
4. Keep the old candidate and the new candidate.
5. Select the best candidate as the final video for that segment.

## Backend API

Endpoint:

```http
POST /api/production/workbench/regenerateVideo
```

Body:

```json
{
  "projectId": 1,
  "scriptId": 2,
  "trackId": 3001,
  "model": "volcengine:seedance-2-0",
  "mode": "[\"imageReference:9\",\"audioReference:3\"]",
  "resolution": "1080p",
  "audio": true,
  "autoSelect": false,
  "regeneratePrompt": true
}
```

Behavior:

- Immediately creates an `o_video` candidate with `state = 生成中`.
- Rebuilds the track video prompt for the target model when `regeneratePrompt` is true.
- Automatically selects references:
  - Reference mode: related assets, bound audio assets up to mode limit, then storyboard images.
  - Non-reference mode: storyboard images only.
- Generates video in the background.
- Keeps the previous selected video.
- If `autoSelect` is true, selects the new candidate only after generation succeeds.

## Candidate Metadata

`o_video` now stores generation metadata:

- `model`
- `mode`
- `resolution`
- `audio`
- `source`
- `prompt`

Current sources:

- `workbench-generate`
- `workbench-batch-generate`
- `fallback-regenerate`

`getGenerateData`, `getVideoList`, and `checkVideoStateList` return these fields plus `label`, for example:

```text
fallback-regenerate / volcengine:seedance-2-0 / 1080p
```

## Frontend Product Design

Add a per-segment action in the video candidate area:

```text
Regenerate
```

Dialog controls:

- Model selector: default to project video model, include enabled video models.
- Mode selector: default to the selected model's recommended mode.
- Resolution selector.
- Audio toggle.
- Regenerate prompt toggle: on by default.
- Auto select when done toggle: off by default.

Candidate card should show:

- Source label.
- Model label.
- Resolution.
- Generation state.
- Select button.
- Prompt preview.

Recommended defaults:

- LTX-2.3 output unsatisfactory -> Seedance 2.0 fallback.
- Keep `autoSelect = false` so review remains explicit.
- Keep `regeneratePrompt = true` when switching model families.

## Why This Shape

This keeps video generation non-destructive. Regeneration adds a new candidate instead of replacing the old one, so the user can compare LTX, Seedance, and any later model result for the same segment.
