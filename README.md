# Engine Bench 0.1

Two AI agents build the same engine side by side. Each gets one prompt and the same CAD tools, then works until it is done, with no hand-holding. The goal is our 894-part model of a real 1990s 1.6 L inline-four.

Live at [toolsenabled.ai/bench](https://toolsenabled.ai/bench/).

Read [METHOD.md](METHOD.md) for the rules, scoring formula, verification limits and versioning promise, and [CHANGELOG.md](CHANGELOG.md) for the release history.

## How a race works

1. You pick any two models from the 15 providers in [src/providers.ts](src/providers.ts) and paste your own API keys.
2. Before the clock starts, the page checks each key with a free model lookup.
3. Both agents start at the same moment. Each gets its own workspace and its own view on the page.
4. Each agent works in turns. A turn is one model call, then its tool calls.
5. The run ends when the agent calls `finish` or stops calling tools. There is no budget. Time, tokens and cost are measured, never capped. A safety stop at 150 turns or 90 minutes guards your key against a runaway loop.
6. The page scores both models against the goal. Download the run records, a share card, a model grid or a 15-second timelapse for X.

Everything runs in your browser. Each key goes only from your browser to its own provider. The page's Content Security Policy allows connections only to the 15 provider APIs listed in [src/providers.ts](src/providers.ts). ToolsEnabled receives nothing from a run.

## What is the same for both agents

- **Prompt.** One fixed system prompt and spec pack ([src/specs.ts](src/specs.ts)). It is the same for every race, and the page shows its fingerprint.
- **Tools.** Six tools with the same names, descriptions and schemas ([src/tools.ts](src/tools.ts)):
  - `add_parts`
  - `remove_parts`
  - `list_parts`
  - `render_view`
  - `get_reference`
  - `finish`
- **No budget.** Each agent works until it is done. The optional reasoning effort is passed to both agents where the provider supports it.
- **Pictures.** Every render is 800 × 600 from the same cameras, light and colours. Goal renders are made once and given to both agents.
- **Scoring.** The same function scores both models ([src/score.ts](src/score.ts)).

## Scoring

The score runs from 0 to 100, measured against the reference model. The reference model scores 100 against itself.

| Weight | What | How |
|---|---|---|
| 25% | Silhouette | Overlap with the reference from the timing end, the exhaust side and the top, on a 256 × 256 grid |
| 20% | Surface | From all six sides, the share of pixels where the surface is within 10 mm of the reference |
| 35% | Key dimensions | Cylinder count, bore, bore spacing, crank height, valve count and overall size, read from parts tagged with a role |
| 20% | Coverage | How many of the 18 named roles have at least one part |

## The goal model

- `model/`: the full reference model.
  - 894 separate parts and 439 mesh files.
  - Each part has a public name, subsystem, mass and pose.
  - The mesh format and the axes are described in `model/parts.json`.
- `site/static/bench/goal/`: the same 894 parts with simplified display meshes, for the web page (2.6 MB).
  - Built by `npm run goal`.
  - Every part is kept separate.

## Run it locally

```sh
npm install
npm run check          # type-check against the official SDKs
npm run build          # bundle the page into site/static/bench/js
node tools/serve.mjs   # preview with the production headers on http://127.0.0.1:8787
```

The preview server serves `site/` on top of a copy of the main site. Point it at the main site with `LIVE_SITE`.

To try the page without keys, open `/bench/?dev=mock`. It runs two scripted test agents and calls no model.

## Records, verification and leaderboard

**Download run records** saves one JSON file with the race date and both agent records. Each record carries version `0.1`, the 12-hex prompt fingerprint, the hashed goal filename, model and effort, time, turns, usage, cost, score and every tool call, including calls rejected before dispatch. It contains no keys, chat or reasoning; the free-text `finish` summary is omitted.

**Check a run record**, near the leaderboard, accepts a single record or a race file. It animates the recorded CAD calls in fresh workspaces, then uses the unchanged scoring function to check the total within ±0.5 points. No model is called. The replay fills the arena and results, with all exports available.

The leaderboard reads [site/static/bench/results/leaderboard.json](site/static/bench/results/leaderboard.json), edited by hand from verified records. Models appear in a ranked table and a horizontal bar chart. Three scripts (`test-full`, `test-half`, `test-box`) appear separately as calibration, never as ranked models. Their generated records are in the same results directory; scores are pending a WebGL browser check. Run `node tools/generate-baselines.mjs` to regenerate them. Checking a pending baseline in the page computes its score and lets you download the filled record.

Send an unedited race through the [run-record issue form](https://github.com/ToolsEnabled/engine-bench/issues/new?template=run-record.yml). Maintainers replay it before adding an entry. Verification checks geometry and score, not model identity or billed usage.

X exports include 1600 × 900 versus cards, leaderboard charts and up-to-eight-model grids; 1080 × 1350 cards and grids; a 15-second timelapse; post text; and an Open X link. Every image carries Engine Bench 0.1, the page address and prompt fingerprint. Leaderboard grids use the first eight ranked models with records and replay them off-screen.

## Licences

- Code: MIT ([LICENSE](LICENSE)).
- Model files: see [model/LICENSE.md](model/LICENSE.md).
- Bundled third-party code: licences are listed in `site/static/bench/js/THIRD-PARTY-LICENSES.txt`.

Engine Bench 0.1 is an independent project. It is not affiliated with or endorsed by any AI provider. Model names belong to their owners.
