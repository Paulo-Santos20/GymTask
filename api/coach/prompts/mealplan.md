# Task: build a day of eating

Turn `nutrition.targets` — the TDEE and macro targets from the lifter's own recorded intake — into one day of meals. `nutrition.recent`, when present, is their last logged days (`d`, `kcal`, `protein`, `carbs`, `fat`): use it to see what they actually eat and how far the target sits from it, not to judge it. If `nutrition` is absent, say in `summary` that the targets are unknown and still build one sensible day from `coachProfile`.

## Constraints

- Exactly four meals, one per diary section, in this order with exactly these slot names: `cafe`, `almoco`, `lanche`, `jantar`. The diary has no other section — any other slot writes into nowhere.
- Each meal holds 1–12 items. Every item is a food the lifter would recognise in their own diary: `name`, `grams` for that portion, and `kcal`, `protein`, `carbs`, `fat` as non-negative numbers for exactly that portion.
- The day lands near `targets.kcal` (within a few percent) with `protein` at or above `targets.protein`; spread carbs and fat around training and preference.
- `coachProfile.dislikes` stays off the list; `likes` steer toward what they already enjoy. Everyday food, portions a normal kitchen produces — nothing that needs a name they would not type.
- `recent` shows what is realistically logged. Meet the lifter partway: the best day of eating is the one that gets logged.

## Output

```
{
  "coach_contract": 1,
  "summary": "<2-3 sentences: how the day hits the targets, with the calorie number>",
  "totals": { "kcal": <number>, "protein": <number>, "carbs": <number>, "fat": <number> },
  "meals": [
    { "slot": "cafe", "items": [{ "name": "<food>", "grams": <number>, "kcal": <number>, "protein": <number>, "carbs": <number>, "fat": <number> }] },
    { "slot": "almoco", "items": [{ "name": "<food>", "grams": <number>, "kcal": <number>, "protein": <number>, "carbs": <number>, "fat": <number> }] },
    { "slot": "lanche", "items": [{ "name": "<food>", "grams": <number>, "kcal": <number>, "protein": <number>, "carbs": <number>, "fat": <number> }] },
    { "slot": "jantar", "items": [{ "name": "<food>", "grams": <number>, "kcal": <number>, "protein": <number>, "carbs": <number>, "fat": <number> }] }
  ]
}
```

- `totals` is the sum of the items you list — the app recomputes it either way, so do not state a number the items do not add up to.
- No exercise ids, no plan changes, no `changes`/`routines`/`week`: a meal plan touches the food diary and nothing else. No medical claims — if a target looks like it came from a medical condition, note it in `summary` and stay inside the numbers you were given.
