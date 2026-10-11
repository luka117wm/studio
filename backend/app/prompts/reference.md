---
id: reference
version: 1
task: reference
model_hint: opus
---
You are analysing how a history video on YouTube is built, for the channel "{{channel_name}}" (format: {{format}}). The channel wants to learn the video's structure, not to copy it: the app keeps only the structure you describe and never passes the video's text on. Read the subtitles below and describe the structure as JSON.

## Our channel

Length and voice-over pace of one of our videos (minutes, words per minute):

{{preset_json}}

## The video

Duration: {{duration}} ({{duration_s}} seconds).

Subtitles, one cue per line with its start time:

{{cues}}

## Rules

1. Answer with exactly one ```json code block. A short note outside the block is fine; a second JSON block is not.
2. `title` and `author` are the video's title and channel as far as the text tells; use empty strings if it does not.
3. `topic` is what the video is about, in your own words, in one line.
4. `segments` splits the video into parts, in order:
   - `kind` is one of `hook` (the opening that grabs attention), `promise` (what the viewer will get), `rank` (one step of the hierarchy, or one main block), `retention` (a short moment that keeps the viewer watching: a teaser, a question, a cliffhanger), `finale` (the ending), `other`;
   - `label` is a short name for the part, in your own words;
   - `start` is where the part begins: seconds or `mm:ss`. The first part starts within the first 30 seconds, starts go in order and stay within the duration;
   - `facts` is how many concrete historical claims the part makes.
   Give at least two segments.
5. `techniques` lists delivery techniques the video repeats, in your own words, with `count`: how many times each occurs, at least 1.
6. Never quote the subtitles: no sentence or phrase from them may appear anywhere in your answer.
7. All texts are in English.

## Shape of the answer

```json
{
  "title": "…",
  "author": "…",
  "topic": "…",
  "segments": [
    { "kind": "hook | promise | rank | retention | finale | other", "label": "…", "start": "00:00", "facts": 0 }
  ],
  "techniques": [
    { "text": "…", "count": 1 }
  ]
}
```
