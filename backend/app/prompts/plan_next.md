---
id: plan_next
version: 2
task: plan
model_hint: opus
---
Continue the director plan of a narrated history video for the YouTube channel "{{channel_name}}" (format: {{format}}). The plan is a JSON document in the format `studio.director/1`, written in {{parts_total}} parts; earlier parts are already accepted by the app.

This is part {{part}} of {{parts_total}}: write shots {{first_shot}} to {{last_shot}}, picking up right after the last accepted shot. If this is the last part, finish the video in it.

## Accepted so far

Sections, the number of shots, the last shot, and the era and character look ids used so far:

{{accepted_json}}

## Brief

{{brief_json}}

## Reference structure

{{reference_json}}

`null` means there is no reference video. Otherwise keep following it as in part 1, the way its `mode` says: the order of the remaining segment kinds, roughly their lengths, the pace and the techniques. Never reuse wording from the reference video: the app compares your voice-over with it.

## Rules

The rules of part 1 still apply. The key ones:

1. Answer with exactly one ```json code block that holds the whole part. A short note outside the block is fine; a second JSON block is not.
2. Copy this `meta` exactly:

{{meta_json}}

3. Write only `schema`, `meta`, `sections`, `shots`, `music` and `facts`. Do not write `canon_ref`, `voice`, `brief`, `thumbnail` or `publish`: the app takes them from part 1.
4. Shot ids continue from {{first_shot}} without gaps. A section that goes on from the last part keeps its id and is repeated in `sections` unchanged: same title and direction. New sections continue the numbering.
5. `image.prompt` says only what happens in the frame: the action, the composition, the camera angle. No style words — render quality (photorealistic, 8k), lighting styles (cinematic lighting, golden hour), lenses and optics (35mm, bokeh, depth of field), artistic media (oil painting, anime, concept art) or artists' names and "in the style of" — and no faces, clothing or the look of the era. The app adds all that from its canon.
6. For an era or a character look that was used before, reuse its id from `periods` and `appearances` above. A character who changes rank, age or era gets a new look id in the form `<character>@<look>`, e.g. `you@quartermaster-28`.
7. Every concrete historical claim in this part's voice-over goes to `facts`, checked with web search: `status` `verified | disputed | not_found`, `source_url` (`null` if nothing was found), `shot_id` of the shot that makes the claim.
8. All texts are in English.

## Shape of the part

```json
{
  "schema": "studio.director/1",
  "meta": { "...": "exactly as above" },
  "sections": [{ "id": "r3", "title": "...", "chapter": true, "vo_direction": "how to read this section" }],
  "shots": [{
    "id": "{{first_shot}}",
    "section": "r3",
    "vo": "the voice-over of this shot, one or two sentences",
    "image": {
      "prompt": "action, composition and camera angle only",
      "period": "caribbean-1716",
      "appearances": ["you@quartermaster-28"],
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
  "music": [{ "section": "r3", "mood": "...", "gain_db": -24 }],
  "facts": [{ "claim": "...", "status": "verified | disputed | not_found", "source_url": "https://...", "shot_id": "{{first_shot}}" }]
}
```

Ranges: `motion.strength` 0–0.25; `transition_in.duration` 0–1.5 seconds; `animate.seconds` 2–10; `gain_db` −40–0. `overlay` is always `null`.
