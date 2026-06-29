# Codex Skill Integration Plan

## Current Readiness

Status: ready for implementation, not ready for daily Codex operation yet.

Toonflow already has the backend capability needed for a Codex-driven production workflow. The missing layer is a deterministic Codex-facing CLI plus a small local Codex Skill that tells Codex how to use that CLI safely.

In practical terms:

- Backend APIs exist for prompt package export/import and per-segment video fallback regeneration.
- Authentication is already enforced globally, so every Codex operation must handle login or token input.
- Prompt package structure is stable enough to automate.
- Video regeneration is non-blocking and returns a `videoId` immediately, so polling is mandatory.
- No project-local `toonflow:codex` command exists yet.
- No installed `toonflow-production` Codex Skill exists yet.

This means the integration is buildable now, but the previous plan was not quite executable because it did not pin down API contracts, CLI behavior, output formats, validation gates, and the actual gap between existing scripts and the desired Codex workflow.

## Goal

Turn Toonflow into a local production surface that Codex can drive through a dedicated Skill.

The first version should not replace the Toonflow UI. Toonflow remains responsible for project data, assets, storyboards, video candidates, review, and final selection. Codex acts as an external production operator that can export prompts, generate or coordinate external outputs, import results, inspect video candidates, and selectively regenerate video segments.

## Product Positioning

Codex should control the parts where flexible reasoning, batch work, and file orchestration are useful:

- Export image prompt packages for role, scene, prop, and storyboard generation.
- Generate or coordinate image outputs outside Toonflow's built-in image vendors.
- Import generated images back into Toonflow.
- Inspect projects, scripts, video tracks, candidates, and generation status.
- Regenerate specific video segments with another model, such as switching from RunningHub LTX-2.3 to Seedance.
- Poll results and report which items succeeded or failed.

Toonflow should continue to own:

- Project creation and visual/manual configuration.
- Story/script editing.
- Asset and storyboard data storage.
- Built-in vendor configuration.
- Video candidate display and manual review.
- Final video selection.

## Recommended Shape

Use a two-layer design:

```text
Codex Skill
  -> Toonflow Codex CLI
    -> Local Toonflow HTTP API
      -> Toonflow DB / OSS / AI vendors
```

The Skill should contain concise operational instructions and references. The actual API calls, login, token handling, polling, local package writing, image conversion, and JSON formatting should live in a deterministic CLI script.

This avoids fragile ad hoc curl commands and prevents Codex from having to remember endpoint details during production work.

## Why Not Put Everything in the Skill

A Codex Skill is best used for procedure, domain knowledge, and bundled helper scripts. It is not a long-running app server and should not duplicate Toonflow's business logic.

Putting the whole project inside a Skill would create several problems:

- The Skill would drift from the real Toonflow codebase.
- Large project context would be expensive and noisy for Codex to load.
- Database and OSS writes would still need Toonflow's runtime helpers.
- UI review would be weaker than using Toonflow's existing production workbench.

Therefore the Skill should drive Toonflow, not reimplement it.

## Existing Project Foundation

The project already has most of the required backend surfaces:

- Local server starts on `10588` by default through `src/app.ts`.
- All APIs are mounted under `/api` through `src/router.ts`.
- Auth middleware protects every API except `/api/login/login`.
- Login exists at `/api/login/login` and returns `data.token` with the `Bearer ` prefix.
- Prompt package export exists at `/api/promptPackage/export`.
- Prompt package import exists at `/api/promptPackage/import`.
- Manual import helper exists at `scripts/importPromptPackageOutputs.ts`.
- Project listing exists at `/api/project/getProject`.
- Script listing exists at `/api/script/getScrptApi`.
- Video track data is available through `/api/production/workbench/getGenerateData`.
- Batch video generation exists at `/api/production/workbench/batchGenerateVideo`.
- Segment fallback regeneration exists at `/api/production/workbench/regenerateVideo`.
- Video status polling exists at `/api/production/workbench/checkVideoStateList`.
- Supporting docs already exist in `docs/prompt-package-manual-image-flow.md` and `docs/segment-video-fallback-regenerate.md`.

The main missing piece is a stable Codex-facing CLI that wraps login, authorization, request payloads, response normalization, polling, local file handling, and clear error output.

## Gaps To Close Before Skill Use

| Gap | Current state | Required change | Blocking for V1 |
| --- | --- | --- | --- |
| CLI entrypoint | No `toonflow:codex` script | Add `scripts/toonflowCodex.ts` and package script | Yes |
| Auth handling | Existing APIs require bearer token | CLI must support `--token`, `TOONFLOW_TOKEN`, or login | Yes |
| Prompt package export to disk | API returns `files` and optional zip URL/path | CLI must write `files` locally and optionally expose zip metadata | Yes |
| Prompt package import auth | Existing helper posts without `Authorization` | Fold helper into CLI or update it to use token | Yes |
| Video polling | API returns completed/failed videos only | CLI must poll until done, failed, or timeout | Yes |
| Skill package | Not present | Create `~/.codex/skills/toonflow-production` | Yes |
| E2E sample data | Depends on local DB | Document a small fixture/manual test project | Yes |
| Bulk regeneration | Backend has batch generation but not Codex decision flow | Defer to V2 | No |
| Auto final selection | Supported by `autoSelect` in regenerate API | Keep disabled by default | No |

## Version 1 Scope

Version 1 supports five production flows.

### Flow 1: Login

Codex command:

```bash
yarn toonflow:codex login --json
```

Expected behavior:

- Calls `POST /api/login/login`.
- Uses `--username`, `--password`, `TOONFLOW_USERNAME`, `TOONFLOW_PASSWORD`, or defaults.
- Prints `token`, `name`, and `id`.
- Does not write the token to disk in V1.

### Flow 2: Export Prompt Package

Codex command:

```bash
yarn toonflow:codex export-prompt-package \
  --project-id 1 \
  --script-id 2 \
  --include-assets \
  --include-storyboards \
  --include-references \
  --zip \
  --out-dir ./tmp/toonflow-prompt-package
```

API:

```http
POST /api/promptPackage/export
Authorization: Bearer ...
```

Request body:

```json
{
  "projectId": 1,
  "scriptId": 2,
  "includeAssets": true,
  "includeStoryboards": true,
  "includeReferences": true,
  "asZip": true
}
```

Expected result:

- Writes returned `files` to `--out-dir`.
- Creates `outputs/` if absent.
- Prints a JSON summary with `projectId`, `scriptId`, `packageDir`, `zipPath`, `zipUrl`, and item counts by `asset` and `storyboard`.
- Does not depend on downloading `zipUrl`; local `files` are enough for Codex generation.

### Flow 3: Import Prompt Package Outputs

Codex command:

```bash
yarn toonflow:codex import-prompt-package \
  --package-dir /path/to/toonflow-prompt-package
```

API:

```http
POST /api/promptPackage/import
Authorization: Bearer ...
```

Request body shape:

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
      "resolution": "2K",
      "base64Data": "data:image/png;base64,..."
    }
  ]
}
```

Expected result:

- Reads `manifest.json`.
- Reads every file listed by `item.suggestedOutput`.
- Supports `jpg`, `jpeg`, `png`, and `webp`.
- Treats missing output images as a hard local error before calling the API.
- Converts images to data URLs.
- Calls `/api/promptPackage/import`.
- Prints imported and failed items.

This supersedes or wraps `scripts/importPromptPackageOutputs.ts`, because the current helper does not handle API authorization.

### Flow 4: Inspect Video Tracks

Codex command:

```bash
yarn toonflow:codex get-video-tracks \
  --project-id 1 \
  --script-id 2
```

API:

```http
POST /api/production/workbench/getGenerateData
Authorization: Bearer ...
```

Request body:

```json
{
  "projectId": 1,
  "scriptId": 2
}
```

Expected result:

- Returns `storyboardList` and normalized `trackList`.
- For each track, report `id`, `duration`, `state`, `reason`, `selectVideoId`, media count, and video candidate list.
- For each candidate, include `id`, `state`, `errorReason`, `model`, `mode`, `resolution`, `audio`, `source`, `label`, and `src`.

### Flow 5: Regenerate One Video Segment

Codex command:

```bash
yarn toonflow:codex regenerate-video \
  --project-id 1 \
  --script-id 2 \
  --track-id 3001 \
  --model atlascloud:bytedance/seedance-2.0/text-to-video \
  --mode '["imageReference:9","audioReference:3"]' \
  --resolution 720p \
  --duration 5 \
  --audio \
  --regenerate-prompt \
  --poll \
  --no-auto-select
```

API:

```http
POST /api/production/workbench/regenerateVideo
Authorization: Bearer ...
```

Request body:

```json
{
  "projectId": 1,
  "scriptId": 2,
  "trackId": 3001,
  "model": "atlascloud:bytedance/seedance-2.0/text-to-video",
  "mode": ["imageReference:9", "audioReference:3"],
  "resolution": "720p",
  "duration": 5,
  "audio": true,
  "autoSelect": false,
  "regeneratePrompt": true
}
```

Expected result:

- Calls `/api/production/workbench/regenerateVideo`.
- Returns `videoId`, `trackId`, `model`, `mode`, and `autoSelect`.
- If `--poll` is set, polls `/api/production/workbench/checkVideoStateList`.
- Leaves the result as a new video candidate unless `--auto-select` is set.

## CLI Design

Add a project-local script:

```text
scripts/toonflowCodex.ts
```

Add package script:

```json
{
  "toonflow:codex": "tsx scripts/toonflowCodex.ts"
}
```

The CLI should support:

```text
login
export-prompt-package
import-prompt-package
get-projects
get-scripts
get-video-tracks
regenerate-video
poll-videos
```

### Shared Options

All commands should accept:

- `--base-url`, default `http://localhost:10588`.
- `--username`, default from `TOONFLOW_USERNAME`, fallback `admin`.
- `--password`, default from `TOONFLOW_PASSWORD`, fallback `admin123`.
- `--token`, optional direct token.
- `--json`, print machine-readable JSON only.

### Token Handling

The CLI should:

1. Use `--token` if provided.
2. Otherwise use `TOONFLOW_TOKEN` if present.
3. Otherwise call `/api/login/login` with username/password.
4. Add `Authorization` to all protected API requests.

Do not write tokens to disk in Version 1. Environment variables and explicit CLI flags are enough.

Normalize both raw JWT and bearer values:

- `--token abc.def.ghi` becomes `Authorization: Bearer abc.def.ghi`.
- `--token "Bearer abc.def.ghi"` is passed through.
- Login response `data.token` is already a bearer value.

### API Response Handling

All Toonflow JSON responses use:

```ts
interface ApiResponse {
  code: number;
  data: any;
  message: string;
}
```

The CLI should fail when:

- HTTP status is not 2xx.
- `code` is not `200`.
- The expected `data` field is missing.

Human mode should print concise progress and summaries. `--json` mode should print only the final JSON object to stdout, with diagnostics on stderr.

### Argument Parsing

Keep dependencies minimal. A small internal parser is acceptable for V1 because the command set is narrow.

Required parser behavior:

- Convert kebab-case flags to camelCase in code.
- Support boolean flags like `--zip`, `--audio`, `--poll`.
- Support negated booleans like `--no-auto-select`.
- Parse numeric IDs as numbers.
- Parse `--mode` as JSON when it starts with `[`; otherwise pass it as a string.

### File Handling

For `export-prompt-package`:

- If `--out-dir` is omitted, create a timestamped directory under `./tmp/toonflow-prompt-packages/`.
- Write each returned `files[]` entry using its relative `path`.
- Refuse to write any returned file path that escapes the package directory.
- Create `outputs/` if absent.

For `import-prompt-package`:

- Refuse to import if `manifest.packageType !== "toonflow-image-prompt-package"`.
- Refuse to import if any `suggestedOutput` path escapes the package directory.
- Verify all output files exist before making the API call.
- Include `resolution` from item `size`.

### Polling

Add:

```bash
yarn toonflow:codex poll-videos \
  --project-id 1 \
  --script-id 2 \
  --video-ids 10,11,12 \
  --timeout-ms 600000 \
  --interval-ms 5000
```

API:

```http
POST /api/production/workbench/checkVideoStateList
Authorization: Bearer ...
```

Request body:

```json
{
  "projectId": 1,
  "scriptId": 2,
  "videoIds": [10, 11, 12]
}
```

Important backend behavior:

- This endpoint currently returns only videos whose state is `生成成功` or `生成失败`.
- An empty result does not mean failure; it means generation is still running or the ID is invalid.
- The CLI should keep polling until every requested ID appears, or until timeout.
- If timeout occurs, return a non-zero exit code and include pending IDs.

## Skill Design

Create a local Codex Skill:

```text
~/.codex/skills/toonflow-production/
├── SKILL.md
├── references/
│   ├── workflows.md
│   ├── api.md
│   └── model-routing.md
└── scripts/
    └── toonflow-codex-wrapper.sh
```

The Skill should trigger when the user asks Codex to operate Toonflow projects, export prompt packages, import generated images, regenerate video segments, switch between RunningHub LTX and Seedance, or inspect Toonflow production status.

`SKILL.md` should stay short. It should tell Codex:

- Verify the Toonflow server is running.
- Use `yarn toonflow:codex` from the Toonflow repo instead of raw API calls.
- Keep Toonflow as the source of truth.
- Use prompt package flow for Codex/manual image generation.
- Use fallback regenerate for per-segment video model switching.
- Never overwrite selected video automatically unless the user asks.

Detailed API payloads should live in `references/api.md`.

### Minimal SKILL.md Outline

```markdown
---
name: toonflow-production
description: Operate local Toonflow production projects through the Toonflow Codex CLI: export/import image prompt packages, inspect video tracks, regenerate video segments, and poll status.
---

# Toonflow Production

Use this skill when the user asks to operate a local Toonflow project from Codex.

Before work:
- Work from the Toonflow repo root.
- Confirm the server is reachable at `http://localhost:10588` or the user's `--base-url`.
- Use `yarn toonflow:codex`; do not call raw APIs unless the CLI is missing and the user explicitly accepts a fallback.

Safety:
- Toonflow is the source of truth.
- Do not delete project data.
- Do not change vendor credentials.
- Do not auto-select generated video unless explicitly requested.
- Do not regenerate many tracks without an explicit track list.

Read references/workflows.md for workflows, references/api.md for command/API details, and references/model-routing.md for model policy.
```

## Image Generation Workflow

Recommended Codex behavior:

1. Export prompt package from Toonflow.
2. Read `manifest.json` and `codex-batch.md`.
3. Generate images with Codex image generation or ask the user to manually place images in `outputs/`.
4. Save images to the exact `suggestedOutput` paths.
5. Import the package back into Toonflow.
6. Report failed items and missing outputs.

The first version can support both modes:

- Assisted manual mode: Codex prepares the package and instructions, user creates images.
- Codex generation mode: Codex generates images and writes outputs directly.

## Video Generation Workflow

Recommended Codex behavior:

1. Get track data from Toonflow.
2. Identify target track IDs.
3. Use the user's preferred model policy.
4. Call `regenerate-video` for selected tracks.
5. Poll status.
6. Return a compact status report with video IDs, model, state, and error reason.

The default must be `--no-auto-select`, because product review should stay explicit.

## Model Routing Policy

Use this policy in the Skill reference:

- Use RunningHub LTX-2.3 text-to-video for text-only simple shots.
- Use RunningHub LTX-2.3 image-to-video for simple single storyboard image motion.
- Use RunningHub LTX-2.3 Workflow only when `workflowId` and `workflowNodeMapJson` are configured and verified.
- Use Seedance for difficult identity consistency, multi-asset reference, and fallback regeneration.
- Use Seedance when a segment failed or looked wrong under LTX and needs a higher-reliability retry.

## Safety Rules

- Do not delete project data from the Skill.
- Do not change vendor credentials from the Skill in Version 1.
- Do not auto-select newly generated videos unless explicitly requested.
- Do not regenerate all tracks without a clear track list or explicit user confirmation.
- Treat missing images in prompt package outputs as a hard error before import.
- Report partial import failures instead of hiding them.
- Keep generated images and package files inside the requested package directory.
- Do not log passwords or full tokens.

## Implementation Tasks

| ID | Source | Task | Dependencies | Test points | Done signal |
| --- | --- | --- | --- | --- | --- |
| T001 | V1, CLI | Add `scripts/toonflowCodex.ts` with command dispatch, shared option parsing, JSON output mode, and exit codes | None | Run unknown command and missing required flag cases; verify non-zero exit and useful error | CLI skeleton handles all V1 command names |
| T002 | Auth | Implement login and token normalization | T001 | `login --json` returns token; protected call succeeds with `--token`; raw JWT becomes bearer header | CLI can authenticate without manual curl |
| T003 | Export | Implement `export-prompt-package` file writing | T002 | Export small project; inspect `manifest.json`, `codex-batch.md`, `prompts/`, `outputs/`; path traversal fixture is rejected | Prompt package exists locally and summary JSON includes counts |
| T004 | Import | Implement `import-prompt-package` with authorized API call | T002 | Missing output image fails before API call; sample png imports; unsupported extension fails clearly | Generated package outputs can be imported from one command |
| T005 | Inspect | Implement `get-projects`, `get-scripts`, and `get-video-tracks` | T002 | Commands return normalized JSON for existing project/script; missing IDs produce clear errors | Codex can discover IDs and video candidates |
| T006 | Regenerate | Implement `regenerate-video` | T002, T005 | Valid track returns `videoId`; invalid track fails; default `autoSelect` is false; JSON array mode is sent as array | One segment can be regenerated as a new candidate |
| T007 | Poll | Implement `poll-videos` and `--poll` integration for regenerate | T006 | Completed and failed videos return final state; running video times out with pending IDs; empty poll response is treated as pending | Codex can wait for asynchronous video jobs |
| T008 | Package script | Add `toonflow:codex` to `package.json` | T001 | `yarn toonflow:codex login --help` or equivalent command dispatch works | Repo exposes stable Codex command |
| T009 | Skill | Create `~/.codex/skills/toonflow-production` with references | T001-T008 | Skill files pass Codex skill validation; instructions point to CLI not raw API | Codex can load a small Toonflow production skill |
| T010 | E2E | Run dry integration on a small project | T001-T009 | Login, export, import prepared output, inspect tracks, regenerate one segment, poll | V1 is ready for repeatable use |

## Version 1 Acceptance Criteria

Version 1 is complete when:

- Codex can authenticate against a running Toonflow server.
- Codex can list projects and scripts to find IDs.
- Codex can export a prompt package with one command.
- Codex can import generated package outputs with one command.
- Codex can inspect video tracks and candidates.
- Codex can trigger one segment video regeneration with one command.
- Codex can poll video IDs and show completed/failed states.
- Toonflow UI can display the imported images and generated video candidates.
- No final selected video is overwritten unless `--auto-select` is explicitly used.
- All command outputs are usable by Codex in `--json` mode.

## Second Version Scope

After Version 1 works reliably, add:

- `batch-regenerate-video`: regenerate multiple tracks from a decision file.
- `review-video-candidates`: produce a structured report from current candidate states and metadata.
- `configure-runninghub-workflow`: validate required RunningHub workflow fields are present.
- Import batching for very large prompt packages.
- Optional token cache with explicit user opt-in.
- Better fixture-based CLI tests that do not require a real video vendor call.

Do not add fully automatic final selection until the user has reviewed several real projects. Final selection has product risk and should remain explicit by default.

## Known Risks

### Server State

The CLI depends on Toonflow server being running. The Skill should check the server before work and tell the user to start it if unavailable.

### Auth Drift

Default credentials may change. The CLI must support env vars and explicit token input.

### Background Tasks

Some Toonflow APIs return immediately while work continues in the background. The CLI must poll status endpoints instead of assuming immediate completion.

### Large Payloads

Prompt package image import uses base64 data URLs. Large batches may hit request limits or memory pressure. Keep Version 1 imports moderate and add batching later if needed.

### Polling Ambiguity

`checkVideoStateList` only returns completed or failed videos. If a video ID never appears, the CLI cannot distinguish "still running" from "wrong ID" until timeout.

### Model Configuration

RunningHub Workflow only works when the user has configured a valid workflow and node map. The Skill should not promise workflow capabilities until configuration is present.

### Shell Quoting

`--mode` values that are JSON arrays require shell-safe quoting. Skill examples should prefer single quotes around JSON arrays on macOS/Linux.

## Recommended First Test

Use a small project with:

- 1 role asset.
- 1 scene or prop asset.
- 2 storyboard images.
- 1 video track.

Test sequence:

```bash
yarn dev
yarn toonflow:codex login --json
yarn toonflow:codex get-projects --json
yarn toonflow:codex get-scripts --project-id 1 --json
yarn toonflow:codex export-prompt-package --project-id 1 --script-id 1 --include-assets --include-storyboards --include-references --zip --out-dir ./tmp/test-prompt-package --json
yarn toonflow:codex import-prompt-package --package-dir ./tmp/test-prompt-package --json
yarn toonflow:codex get-video-tracks --project-id 1 --script-id 1 --json
yarn toonflow:codex regenerate-video --project-id 1 --script-id 1 --track-id 1 --model runninghub:ltx-2.3/image-to-video --mode singleImage --resolution 1080p --duration 5 --audio --poll --no-auto-select --json
```

If this passes, the integration is ready to become a repeatable Codex production Skill.
