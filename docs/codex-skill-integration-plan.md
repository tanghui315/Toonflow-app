# Codex Skill Integration Plan

## Goal

Turn Toonflow into a local production surface that Codex can drive through a dedicated Skill.

The first version should not replace the Toonflow UI. Toonflow remains responsible for project data, assets, storyboards, video candidates, review, and final selection. Codex acts as an external production operator that can export prompts, generate or coordinate external outputs, import results, and selectively regenerate video segments.

## Product Positioning

Codex should control the parts where flexible reasoning and batch operations are useful:

- Export image prompt packages for role, scene, prop, and storyboard generation.
- Generate or coordinate image outputs outside Toonflow's built-in image vendors.
- Import generated images back into Toonflow.
- Inspect video tracks and candidate status.
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

The Skill should contain concise operational instructions and references. The actual API calls, login, token handling, polling, and file conversions should live in a deterministic CLI script.

This avoids forcing Codex to remember endpoint details and prevents fragile ad hoc curl commands.

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
- Prompt package export exists at `/api/promptPackage/export`.
- Prompt package import exists at `/api/promptPackage/import`.
- Manual import helper exists at `scripts/importPromptPackageOutputs.ts`.
- Video track data is available through `/api/production/workbench/getGenerateData`.
- Batch video generation exists at `/api/production/workbench/batchGenerateVideo`.
- Segment fallback regeneration exists at `/api/production/workbench/regenerateVideo`.
- Video status polling exists at `/api/production/workbench/checkVideoStateList`.

The main missing piece is a stable Codex-facing CLI that wraps login, authorization, request payloads, polling, and local file handling.

## First Version Scope

Version 1 should support three production flows.

### Flow 1: Export Prompt Package

Codex command:

```bash
yarn toonflow:codex export-prompt-package \
  --project-id 1 \
  --script-id 2 \
  --include-assets \
  --include-storyboards \
  --include-references \
  --zip
```

Expected result:

- Calls `/api/promptPackage/export`.
- Writes the package or downloads the generated zip to a local path.
- Prints a JSON summary with:
  - `projectId`
  - `scriptId`
  - `packageDir`
  - `zipUrl` or `zipPath`
  - item counts by `asset` and `storyboard`.

### Flow 2: Import Prompt Package Outputs

Codex command:

```bash
yarn toonflow:codex import-prompt-package \
  --package-dir /path/to/toonflow-prompt-package
```

Expected result:

- Reads `manifest.json`.
- Reads all files listed by `suggestedOutput`.
- Converts images to data URLs.
- Calls `/api/promptPackage/import`.
- Prints imported and failed items.

This should supersede or wrap `scripts/importPromptPackageOutputs.ts`, because the current helper does not handle API authorization.

### Flow 3: Regenerate One Video Segment

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
  --no-auto-select
```

Expected result:

- Calls `/api/production/workbench/regenerateVideo`.
- Returns `videoId`.
- Optionally polls `/api/production/workbench/checkVideoStateList`.
- Leaves the result as a new video candidate unless `--auto-select` is set.

## Second Version Scope

After Version 1 works reliably, add:

- `get-projects`: list projects and basic IDs.
- `get-scripts`: list scripts under a project.
- `get-video-tracks`: inspect tracks, references, selected video, and candidates.
- `batch-regenerate-video`: regenerate multiple tracks from a decision file.
- `review-video-candidates`: produce a structured report from current candidate states and metadata.
- `configure-runninghub-workflow`: validate required RunningHub workflow fields are present.

Do not add fully automatic final selection until the user has reviewed several real projects. Final selection has product risk and should remain explicit by default.

## CLI Design

Add a project-local script:

```text
scripts/toonflowCodex.ts
```

Add package scripts:

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

Avoid writing tokens to disk in Version 1. Environment variables are enough.

## Skill Design

Create a local Codex Skill:

```text
~/.codex/skills/toonflow-production/
├── SKILL.md
├── agents/
│   └── openai.yaml
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
- Use the project CLI instead of raw API calls.
- Keep Toonflow as the source of truth.
- Use prompt package flow for Codex/manual image generation.
- Use fallback regenerate for per-segment video model switching.
- Never overwrite selected video automatically unless the user asks.

Detailed API payloads should live in `references/api.md`.

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
3. Use the user's preferred model policy:
   - RunningHub LTX-2.3 for low-cost default generation.
   - RunningHub LTX-2.3 Workflow for configured start/end/reference workflows.
   - Seedance for higher-reliability fallback on problematic segments.
4. Call `regenerate-video` for selected tracks.
5. Poll status.
6. Return a compact status report with video IDs, model, state, and error reason.

The default should be `--no-auto-select`, because product review should stay explicit.

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

## Implementation Steps

1. Add `scripts/toonflowCodex.ts`.
2. Add `toonflow:codex` package script.
3. Update or replace `scripts/importPromptPackageOutputs.ts` to support Authorization.
4. Add CLI commands for login, export, import, regenerate, and poll.
5. Add `docs/codex-skill-integration-plan.md`.
6. Create `~/.codex/skills/toonflow-production` using the skill initializer.
7. Add Skill references for workflows, API, and model routing.
8. Validate the Skill with `quick_validate.py`.
9. Run an end-to-end dry test:
   - start Toonflow server
   - login
   - export a prompt package
   - import prepared outputs
   - regenerate one video segment
   - poll the video status

## Acceptance Criteria

Version 1 is complete when:

- Codex can authenticate against a running Toonflow server.
- Codex can export a prompt package with one command.
- Codex can import generated package outputs with one command.
- Codex can trigger one segment video regeneration with one command.
- Codex can poll video IDs and show completed/failed states.
- Toonflow UI can display the imported images and generated video candidates.
- No final selected video is overwritten unless `--auto-select` is explicitly used.

## Known Risks

### Server State

The CLI depends on Toonflow server being running. The Skill should check the server before work and tell the user to start it if unavailable.

### Auth Drift

Default credentials may change. The CLI must support env vars and explicit token input.

### Background Tasks

Some Toonflow APIs return immediately while work continues in the background. The CLI must poll status endpoints instead of assuming immediate completion.

### Large Payloads

Prompt package image import uses base64 data URLs. Large batches may hit request limits or memory pressure. Keep Version 1 imports moderate and add batching if needed.

### Model Configuration

RunningHub Workflow only works when the user has configured a valid workflow and node map. The Skill should not promise workflow capabilities until configuration is present.

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
yarn toonflow:codex export-prompt-package --project-id 1 --script-id 1 --include-assets --include-storyboards --include-references --zip
yarn toonflow:codex import-prompt-package --package-dir /path/to/package
yarn toonflow:codex get-video-tracks --project-id 1 --script-id 1
yarn toonflow:codex regenerate-video --project-id 1 --script-id 1 --track-id 1 --model runninghub:ltx-2.3/image-to-video --mode singleImage --resolution 1080p --duration 5 --audio
```

If this passes, the integration is ready to become a repeatable Codex production Skill.
