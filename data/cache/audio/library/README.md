# Stock-music library for `scripts/generate_soundtrack.py --provider stock`

Drop royalty-free mp3s in this directory, named after the vibe
they're meant to underscore. The script picks the matching file based
on the variant's `centroid_hook.emotional_pitch` (with a fallback to
`default.mp3`).

## Required filenames (≤ 30 s instrumental, no lyrics ideal)

| filename             | maps to pitches | vibe                                         |
| -------------------- | --------------- | -------------------------------------------- |
| `satisfaction.mp3`   | satisfaction    | punchy upbeat trap-pop, satisfying chimes    |
| `rage_bait.mp3`      | fail, rage_bait | tense build → fail-buzzer / brainrot trap    |
| `curiosity.mp3`      | curiosity       | whimsical playful underscore (cartoon)       |
| `tutorial.mp3`       | tutorial        | bright instructional (app onboarding)        |
| `asmr.mp3`           | asmr            | soft ambient pad, no melody, foley-friendly  |
| `celebrity.mp3`      | celebrity       | confident hip-hop instrumental, podcast-y    |
| `challenge.mp3`      | challenge       | high-energy electronic build, gym-pop        |
| `transformation.mp3` | transformation  | cinematic build-and-release, big drop        |
| `default.mp3`        | _fallback_      | generic catchy mobile-game underscore        |

## Where to find royalty-free tracks

- **Pixabay Music** — https://pixabay.com/music/ (CC0, no attribution)
- **Mixkit** — https://mixkit.co/free-stock-music/ (no-attribution)
- **Bensound** — https://www.bensound.com/free-music-for-videos
- **Free Music Archive** — https://freemusicarchive.org/

The script ffmpeg-loops the track if it's shorter than the video (≈18 s
total: 3 × 5 s clips + 3 s endcard), so 15-30 s loops work fine.

## Alternative: AI-generated tracks

`--provider elevenlabs` or `--provider suno` skip the library entirely
and synthesize a brief from the variant's pitch + scene_flow. Costs
~$0.05 per 30 s with ElevenLabs Music (set `ELEVENLABS_API_KEY` in
`.env`).
