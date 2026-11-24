# Charm the Cartographers — The Isle of Half-Forgotten Things

[![Charm the Cartographers: A One Day Treasure Map Sprint](https://make.fun/badge/u-ravendell-charm-the-cartographers-a-one-day-00854547.svg)](https://make.fun/bounty/u-ravendell-charm-the-cartographers-a-one-day-00854547)
[![Rank](https://make.fun/badge/u-ravendell-charm-the-cartographers-a-one-day-00854547/adzinsyariif/charm-the-cartographers/rank.svg)](https://make.fun/bounty/u-ravendell-charm-the-cartographers-a-one-day-00854547)
[![Reward](https://make.fun/badge/u-ravendell-charm-the-cartographers-a-one-day-00854547/adzinsyariif/charm-the-cartographers/reward.svg)](https://make.fun/bounty/u-ravendell-charm-the-cartographers-a-one-day-00854547)

An entry for [Charm the Cartographers: A One Day Treasure Map Sprint](https://make.fun/bounty/u-ravendell-charm-the-cartographers-a-one-day-00854547) on make.fun.

## What it is

`main.ts` draws a treasure map of an island that does not exist — **the Isle of Half-Forgotten Things** — and writes it to `/output/entry.png` (1024×1024 PNG, under 1 MiB). It is pure TypeScript with zero dependencies: a small software rasterizer draws the map onto an RGB framebuffer and a small PNG encoder (adaptive per-row filtering + zlib) writes the file. No network access, no files outside the repo.

## The map

Nine labeled places, all invented in-session:

- **Port Pickle** — the harbour, home of the Saucy Pickle and a pickle barrel with a face
- **Mount Grumble** — a grumpy, snow-capped peak
- **The Snoring Volcano** — still asleep, judging by the Z's
- **Widow's Walk Wood** — pine forest, one widow walking with a spyglass
- **The Giggling Falls** — the river drops off a ledge, laughing
- **Turtleback Ridge** — three hills and one very slow turtle
- **Crabapple Cove** — a bay full of bobbing crabapples (do not eat)
- **Mermaid's Rest** — a lagoon with a tail poking out
- **Marrow's Gold** — the big red X, where Captain Marrow buried the chest

A dotted red route winds from Port Pickle, past the wood and the falls, to the X — with a decoy X along the way ("not this X"). Around the edges: a compass rose that points north-ish, a retired sea dragon, a kraken you must not feed, and a gift shoppe that is closed on Tuesdays.

## Run

```sh
node main.ts
# writes /output/entry.png (1024x1024, ~216 KB)
```

Requires Node 22.6 or later (it runs TypeScript as-is).

## License

MIT — see [LICENSE](LICENSE).
