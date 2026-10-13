# Engine Bench 0.1 method

Engine Bench 0.1 measures how closely an AI model can build a fixed reference engine with CAD tools from one prompt. The goal is an 894-part model of a real 1990s 1.6 L inline-four. It measures geometry and role tags, not mechanical function, manufacturing readiness, or general intelligence. Part count is reported but does not directly earn points.

## Rules

- Both models receive the same fixed system prompt and spec pack in [src/specs.ts](src/specs.ts), followed by the one kickoff message: `Build the engine.` There is no further human guidance.
- Each starts at the same moment with a fresh, separate Workspace. Each has the same six tool definitions in [src/tools.ts](src/tools.ts): `add_parts`, `remove_parts`, `list_parts`, `render_view`, `get_reference`, and `finish`.
- There is no time, token, or cost budget. Each model works until it calls `finish` or stops calling tools. A visitor can stop a race. Refusals and API errors also end a run, and the end reason is recorded.
- The output limit for one turn is 32,000 tokens for every provider, or the model's own lower limit when the OpenRouter catalogue states one. A provider that refuses that limit runs with its own default, and the activity feed says so.
- A turn that the output limit cuts off before any tool call does not end the run. The page sends one fixed sentence, `Your last turn was cut off by the output limit for one turn before it made a tool call, so nothing ran.`, and the model goes on. Three such turns in a row end the run as **Cut off by the output limit**. In a cut-off turn that did make tool calls, only the call the limit cut off is skipped; the complete calls before it run.
- Every provider gets the same retry policy before an error ends a run: up to four retries with exponential backoff for timeouts, conflicts, rate limits, server errors, network failures and errors reported inside a successful response. A retry is not a new turn.
- If an agent fails with an error on its first turn, before any tool call, the race is void: the other agent is stopped (end reason **Stopped: race void**) and no winner is declared.
- A safety stop prevents another model turn after 150 turns and aborts a run after 90 minutes. A turn is a model request followed by its tool calls. These are runaway guards, not a competitive budget. The unchanged tool and geometry limits still apply, including per-call and total part limits.
- The visitor chooses one effort setting for both models: model default, low, medium, high, or extra high. It is sent only where the page can pass it on for that provider and model, and extra high is sent as high where nothing above high is accepted. The record stores the setting actually sent, with an empty string when none was sent (the model's default). Compare effort settings as well as model IDs.
- Model renders and reference images use the same cameras, lighting, and colours, at 800 × 600. A model that cannot read images receives text saying the picture was not sent. It still receives the same written specs and tools.
- Time, input and output tokens, cache reads and writes, and cost are measured. A reported provider charge takes precedence over list-price estimates. Cost is null when neither is available; `costSource` states which was used. List prices can be entered by the visitor and may differ from the actual bill.

## Frozen inputs and identity

The release constant is `BENCH_VERSION = '0.1'` in [src/version.ts](src/version.ts). Every record stores that version, the page's 12-hex prompt fingerprint, and the goal's hashed `.bin.gz` filename.

The prompt fingerprint is the first 12 hex characters of SHA-256 over UTF-8 `JSON.stringify({ system: systemPrompt({ parts: LIMITS.parts, perCall: LIMITS.perCall }), tools: TOOLS })`. It covers the system prompt, spec pack, and six tool definitions. The kickoff message is fixed by the release. The goal filename identifies the packed goal meshes; the matching JSON supplies the parts and poses. Scoring is identified by the frozen release version.

The 0.1 prompt fingerprint is `b131db1ab5db`. The goal is `engine-goal-v1.704a96f0ed5f.bin.gz`.

## Score

The implementation in [src/score.ts](src/score.ts), using depth maps from [src/studio.ts](src/studio.ts), is authoritative. All four components range from 0 to 1:

`total = 100 × (0.25 × silhouette + 0.20 × surface + 0.35 × dims + 0.20 × coverage)`

Silhouette is the mean intersection-over-union of occupied pixels from the timing end, exhaust side, and top. Depth maps are 256 × 256, framed on the same reference bounds with the same margin. Empty pixels count as empty, including when both models have no surface there.

Surface is the mean over six views: timing end, exhaust side, top, flywheel end, intake side, and bottom. In each view, it is the number of pixels where both surfaces exist and their depths differ by at most 10 mm, divided by the union of occupied pixels.

Dimensions is the unweighted mean of six checks. Numeric checks use `max(0, 1 − abs(value − target) / tolerance)`. Missing required parts score zero for that check.

| Check | Value read from the build | Target | Zero-score tolerance |
|---|---|---|---|
| Cylinders | Number of parts tagged `piston` | 4 | 4 |
| Bore | Mean of each piston's average X and Y bounding-box size | 75 mm | 15 mm (20%) |
| Bore spacing | Mean gap between sorted piston X centres | 84 mm | 16.8 mm (20%) |
| Crank height | Z centre of the union of `crankshaft` parts | −212 mm | 42.4 mm (20%) |
| Valves | Number tagged `intake_valve` or `exhaust_valve` | 16 | 16 |
| Overall size | Mean absolute relative error in X, Y and Z sizes of all parts | Reference bounds | 30% mean relative error |

The overall-size check is `max(0, 1 − meanRelativeError / 0.30)`. Reference bounds are `[-326, -268.2, -376.5]` to `[267.6, 279.5, 167.8]` mm. Coverage is the number of distinct named roles present divided by 18. Roles and their targets are fixed in [src/specs.ts](src/specs.ts). Tags are supplied by the model, so a tag alone does not establish a physically correct component. The reference scores 100 against itself.

## Records and verification

Download run records in the results section. A race file contains `{ date, records: [recordA, recordB] }`; a single record is also accepted by the verifier. Records include version and input identity, provider and model, label, effort, ISO start time, elapsed milliseconds, turns, token usage, cost and source, end reason, component scores and dimension checks, final part count, and tool calls. Each call stores `{ ms, name, input, error }` in dispatch order.

CAD inputs are preserved exactly, including failed calls. The `finish` input is recorded as `{}` to omit its free-text model summary. Keys, model chat, reasoning, provider error text, and returned images are not stored. A call with no parseable JSON input stores null and has no CAD effect. Calls rejected before dispatch carry `skipped: true`, with their parsed input when available; replay ignores these. Raw argument text is never stored.

Choose **Check a run record** near the leaderboard. The page validates the version, prompt fingerprint, goal filename, and record shape, then replays every dispatched `add_parts` and `remove_parts` into a fresh Workspace in order. Calls marked as errors are also replayed because a call can have applied some parts before failing. Replacement IDs, removal, cuts, and the Workspace limits follow the same code as a live build. No provider is contacted. Parts appear in order over a few seconds.

The same GPU depth maps and scoring function recompute the final score. A difference of at most 0.5 points produces **Verified: the score matches (±0.5)**. Otherwise the page shows the recorded and replayed totals. The arena, results, cards, grids, and timelapse use the replayed geometry and score. Downloading a replay preserves the source record, so a differing recorded score is not silently changed.

Verification establishes that the recorded tool inputs reproduce the score. It cannot authenticate which model made the calls, prove an unedited race, or validate reported time, token usage, or charges. Submissions require an unedited-race confirmation, and maintainers check them before adding results.

## Leaderboard and calibration

[site/static/bench/results/leaderboard.json](site/static/bench/results/leaderboard.json) is a static file edited by hand from checked records. Model entries alone are ranked by score. Their record paths point to JSON under `/static/bench/results/`. There are no model entries at release. Submit a race using the [run-record issue form](https://github.com/ToolsEnabled/engine-bench/issues/new?template=run-record.yml).

The three calibration scripts in [src/agents/mock.ts](src/agents/mock.ts) call no AI: `test-full` builds the scripted approximation, `test-half` omits external systems and half the valves, and `test-box` adds one box with the reference's overall bounds tagged `block`. They spend zero tokens and cost zero. They appear in a separate Calibration list and as dashed chart markers when their scores are available, never in the model ranking.

Generate their records with `node tools/generate-baselines.mjs`. The script runs their CAD calls through a Workspace without WebGL and leaves scores null. In a browser, click **Check** for each baseline and download its filled record. Replace the baseline record and copy its score components into the leaderboard, then remove the pending-score note. Regeneration replaces the three baseline entries while keeping model entries; use it before browser calibration.

Baseline milliseconds measure local construction time without model requests. They are not estimates of AI run time. Use `node tools/check-records.mjs` to check input capture, record privacy, replay semantics, identity validation, and all three baseline geometries without WebGL.

## Limits and versioning

Each result is a single run. Scores vary from run to run; the leaderboard is not an estimate of a model's average performance. Model services and defaults may change, and a model ID does not always identify a fixed set of weights. Effort and image support also affect results. GPU raster differences can move a score by a fraction of a point, which is why verification allows ±0.5 points.

Any change to the prompt, spec pack, kickoff, tool definitions, scoring, or goal requires a new benchmark version. Engine Bench 0.1 keeps those inputs and scoring fixed. Interface, documentation, record verification, and export improvements can retain the version only while preserving benchmark behaviour and score meaning.

## Calibration

Scripted models with no AI, scored by the same function, to show what the numbers mean. They are never ranked with models.

| Model | Score |
|---|---|
| The goal itself | 100.0 |
| Baseline script: full spec (53 primitives placed from the spec pack) | 75.3 |
| Baseline script: half (35 primitives) | 58.6 |
| Baseline: one bounding box | 24.1 |

