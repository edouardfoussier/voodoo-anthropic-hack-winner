# Game-feel SFX library for `/api/variants/render-video`

When a variant ad is rendered, the backend automatically splices in
short mobile-game sound effects from this directory at fixed timing
beats matching the 5-second clip boundaries. Drop the mp3s with the
exact filenames listed below and they activate on the next render —
each missing file is silently skipped, so you can ship just the SFX
you want.

## Required filenames + timing

| filename | when it fires | role | suggested length |
|---|---|---|---|
| `whoosh_in.mp3`    | **0.0 s**  | opening attention-grab as clip 1 starts | 0.5–1.0 s |
| `swoosh_1.mp3`     | **4.5 s**  | clip 1 → clip 2 transition swoosh        | 0.4–0.8 s |
| `swoosh_2.mp3`     | **9.5 s**  | clip 2 → clip 3 transition swoosh        | 0.4–0.8 s |
| `drop.mp3`         | **14.5 s** | bass drop / build before the endcard    | 0.6–1.2 s |
| `brand_chime.mp3`  | **15.0 s** | branded chime as the endcard appears    | 0.8–1.5 s |

Volumes are pre-calibrated in `_SFX_TIMELINE` (api/main.py) so the SFX
sit between 0.70 and 0.85, below the music bed (0.25) and the voice
TTS (1.00) — they punctuate without burying the narration.

## Where to find royalty-free SFX

- **Pixabay Sound Effects** — https://pixabay.com/sound-effects/ (CC0)
  - Search "whoosh transition", "swoosh", "bass drop game", "chime ui"
- **Mixkit** — https://mixkit.co/free-sound-effects/ (no attribution)
  - Categories: Transitions, Game, UI, Notifications
- **freesound.org** — https://freesound.org/ (CC0 / CC-BY)
- **Zapsplat** — https://www.zapsplat.com/ (free with account)

## Quick install (one-liner shell loop)

Once you've downloaded the 5 mp3s and renamed them to match the table
above, drop them into this directory. Re-click "Generate Ad" on any
variant in the React UI — the next render auto-includes them. No
backend reload needed.

If you want a sanity check after dropping the files:

    ls data/cache/audio/sfx/*.mp3

You should see exactly the 5 stems above (other names are ignored).

## Why not generate them via AI?

OpenAI's TTS doesn't do sound effects, and ElevenLabs Sound Effects
(text-to-sfx) costs ~$0.20/sound and quality is variable. For a
hackathon demo, stock Pixabay SFX are higher quality, free, and
controllable. AI-generated SFX is on the v2 roadmap.
