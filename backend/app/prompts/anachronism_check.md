---
id: anachronism_check
version: 1
task: check
model_hint: vision
---
You are checking one finished still frame from a historical video set in {{period}}.

These things must NOT appear in this era (anachronisms):
{{forbidden}}

Look carefully at the image. Name only the items from the list above that are clearly visible in the frame, using the exact wording from the list. Do not name anything that is not on the list, do not guess, and do not describe the image. If nothing from the list is visible, return an empty list.

Answer with JSON only, exactly in this form: {"found": ["item from the list", "..."]}
