# Changelog

## 0.1.1 — harness fixes (benchmark version stays 0.1)

The prompt, spec pack, kickoff, tools, scoring and goal are unchanged; the prompt fingerprint is still `b131db1ab5db`.

- A turn cut off by the output limit before any tool call no longer ends the run as "Finished". The page says so in one fixed sentence and the model goes on; three in a row end the run as "Cut off by the output limit" (Anthropic `max_tokens`, OpenAI `incomplete`, chat `finish_reason: length`). A response stopped by a content filter is recorded as declined.
- Providers on the chat completions API now get the same retries as the Anthropic and OpenAI SDKs: up to four, with backoff, for 408, 409, 429, 5xx, network failures and errors inside a 200 response.
- Claude: in a cut-off turn only the cut-off tool call is skipped; the complete calls before it run. A turn retried because its tool JSON could not be parsed now counts the usage the failed attempt reported, and tool inputs are no longer re-parsed on every streamed chunk.
- Every chat provider is sent the same 32,000-token limit per turn (lower when the model's own limit is lower), instead of its own default.
- A race in which an agent fails on its first turn is void: the other agent is stopped and no winner is declared. OpenAI organizations that may not receive reasoning summaries get the turn again without them.
- Records store the effort actually sent. Claude Opus 4.6 and Sonnet 4.6 get high for extra high, and Opus 4.5 now gets the effort setting.
- The activity feeds are no longer live regions, and the state label changes only when the state does. Building yields through a message channel, which background tabs do not throttle like timers.
- `npm test` runs the record checks and 23 provider-loop tests against a scripted fetch.

## 0.1 — 2026-10-05

- Versioned the fixed prompt, six CAD tools, scoring method and 894-part reference as Engine Bench 0.1.
- Added downloadable run records and animated local replay verification.
- Added a static leaderboard with separate scripted calibration baselines and a run-record submission form.
- Added leaderboard charts and model grids, with version and prompt identity on exports. Kept 16:9 and 4:5 cards, post text, the X link and the 15-second timelapse.
- Documented the rules, score, tolerances, verification limits and versioning promise in METHOD.md.
