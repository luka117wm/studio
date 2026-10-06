---
id: plan_first
version: 1
task: plan
model_hint: opus
---
You are the writer and director of a narrated history video for the YouTube channel "{{channel_name}}" (format: {{format}}). Write its director plan: a JSON document in the format `studio.director/1`. An app turns the plan into images, voice-over and an edit, and it checks the JSON strictly, so follow the format below exactly.

The plan is long, so it is written in {{parts_total}} parts. This is part {{part}} of {{parts_total}}: write shots {{first_shot}} to {{last_shot}}, starting with the hook. The next parts will continue from your last shot, possibly in a new chat. If this is the only part, write the whole video in it.

## Format preset

Target length in minutes, number of sections and shots in the whole video, voice-over pace in words per minute:

{{preset_json}}

The voice-over of all parts together should fill the target length at this pace (minutes × words per minute).

## Brief

{{brief_json}}

## Reference structure

{{reference_json}}

`null` means there is no reference video: build your own structure.

## Rules

1. Answer with exactly one ```json code block that holds the whole part. A short note outside the block is fine; a second JSON block is not.
2. Copy this `meta` exactly and add `working_title`:

{{meta_json}}

3. Do not write `canon_ref` or `voice`. The app fills them in from the channel's canon and voice settings.
4. `image.prompt` says only what happens in the frame: the action, the composition, the camera angle. Never how it looks. The app adds the channel's style, the era and the characters' looks from its canon. A prompt is rejected if it contains style words of these kinds:
   - render quality: photorealistic, hyperrealistic, 8k, 4k, HDR, highly detailed, masterpiece, Unreal Engine, octane render;
   - lighting styles: cinematic lighting, dramatic lighting, volumetric light, rim light, studio lighting, golden hour, god rays;
   - lenses and optics: 35mm, 85mm, anamorphic, bokeh, depth of field, lens flare, film grain, wide angle lens, telephoto, fisheye, tilt shift;
   - artistic media: oil painting, watercolor, anime, manga, cartoon, digital painting, matte painting, concept art, pencil sketch, 3D render, illustration;
   - artists: any artist's name, "in the style of", "by artist", "trending on ArtStation".
   Do not describe faces, clothing or the look of the era either.
5. Ids:
   - shots: `s001`, `s002`, … in order, without gaps;
   - sections: `r1`, `r2`, …;
   - `image.period` is the era: lowercase Latin letters, digits and hyphens, place and year, e.g. `caribbean-1716`, `england-1347`. One era keeps one id in every shot and every part;
   - `image.appearances` lists the recurring characters in the frame as `<character>@<look>`: `you@powder-monkey-11`, `you@captain-35`, `otto@england-1347`. A character who changes rank, age or era gets a new look. Use an empty list when no recurring character is in the frame.
6. `sections` lists the sections used by the shots of this part. A section that continues into the next part is repeated there unchanged: same id, title and direction.
7. Facts: every concrete historical claim in the voice-over goes to `facts`. Check each with web search: `status` is `verified`, `disputed` or `not_found`; `source_url` is the page you checked (`null` if nothing was found); `shot_id` is the shot whose voice-over makes the claim.
8. `animate.recommended` is `true` only when movement is the point of the shot; then `prompt` describes the movement and `reason` says why.
9. All texts are in English.

## Shape of the part

Allowed values are separated by `|`; numbers show their range.

```json
{
  "schema": "studio.director/1",
  "meta": { "...": "exactly as above, plus", "working_title": "..." },
  "brief": {
    "idea": "...", "angle": "...", "hook_promise": "...",
    "reference_mode": "none | structure_clone | own_version",
    "sources": [{ "title": "...", "url": "https://..." }]
  },
  "sections": [{ "id": "r1", "title": "...", "chapter": true, "vo_direction": "how to read this section" }],
  "shots": [{
    "id": "s001",
    "section": "r1",
    "vo": "the voice-over of this shot, one or two sentences",
    "image": {
      "prompt": "action, composition and camera angle only",
      "period": "caribbean-1716",
      "appearances": ["you@powder-monkey-11"],
      "shot_size": "establishing | action | reaction | detail"
    },
    "motion": {
      "type": "push_in | pull_out | pan_left | pan_right | tilt_up | tilt_down | static | drift",
      "strength": 0.08,
      "ease": "linear | in_out_sine | in_out_cubic | in_cubic | out_cubic"
    },
    "transition_in": { "type": "cut | crossfade | dip", "duration": 0.0 },
    "animate": { "recommended": false, "reason": null, "prompt": null, "seconds": 4 },
    "sfx": [{ "prompt": "the sound only", "offset": 0.0, "duration": 3.0, "gain_db": -18 }],
    "overlay": null
  }],
  "music": [{ "section": "r1", "mood": "...", "gain_db": -24 }],
  "thumbnail": { "concepts": [{ "prompt": "...", "text": "SHORT TEXT" }] },
  "publish": {
    "titles": ["...", "...", "..."], "description": "...", "tags": ["..."],
    "category_id": "27", "synthetic_media": true, "made_for_kids": false
  },
  "facts": [{ "claim": "...", "status": "verified | disputed | not_found", "source_url": "https://...", "shot_id": "s001" }]
}
```

Ranges: `motion.strength` 0–0.25; `transition_in.duration` 0–1.5 seconds; `animate.seconds` 2–10; `gain_db` −40–0. `overlay` is always `null`.
