'use strict';
const fs = require('fs');

let llama = null, model = null, context = null, loading = null;
let queue = Promise.resolve();

/* ---------- JSON shapes the model is forced to follow (grammar-constrained) ---------- */
const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          ingredients: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: { type: 'string' } },
          nutrients: {
            type: 'array',
            items: {
              type: 'object',
              properties: { item: { type: 'string' }, nutrient: { type: 'string' } },
              required: ['item', 'nutrient'],
            },
          },
          why_it_helps: { type: 'string' },
          warning: { type: 'string' },
        },
        required: ['name', 'ingredients', 'steps', 'nutrients', 'why_it_helps', 'warning'],
      },
    },
  },
  required: ['recipes'],
};

const VERDICTS = ['OK to eat', 'Eat in limited portion', 'Better to avoid'];
const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { enum: VERDICTS },
    reason: { type: 'string' },
    portion: { type: 'string' },
    after_effects: { type: 'string' },
    tip: { type: 'string' },
  },
  required: ['verdict', 'reason', 'portion', 'after_effects', 'tip'],
};

/* ---------- the saved profile is injected into EVERY request ---------- */
function systemPrompt(p) {
  return [
    'You are a careful, friendly kitchen assistant that runs fully offline.',
    `You are helping ${p.name}.`,
    `Health issue: ${p.health}.`,
    `Dietary restrictions: ${p.restrictions || 'none'}.`,
    `Allergies: ${p.allergies || 'none'}. Never use these ingredients or anything derived from them.`,
    'Tailor every answer to the health issue and restrictions above.',
    'Keep every step short (maximum 10 steps per recipe). Be concrete and honest about after-effects. You are not a doctor.',
    'Reply with JSON only, matching the requested format.',
  ].join('\n');
}

function mealPrompt(input, extra) {
  return [
    `Ingredients in stock: ${input.stock}`,
    `Nutrients wanted today: ${input.nutrients || 'not specified - make it balanced'}`,
    'Suggest 3 different simple recipes for today (for example breakfast, lunch, dinner or varied dishes).',
    'For each recipe: name, ingredients with quantities, short steps, nutrients (which ingredient helps with which nutrient),',
    'why_it_helps (how it helps this person\'s health issue), and warning (portion limit and the probable after-effects if eaten too much).',
    extra || '',
  ].join('\n');
}

function checkPrompt(input) {
  return [
    `The user wants to try a new dish made of: ${input.ingredients}`,
    'Decide: verdict (one of the allowed values), reason (one or two sentences linked to their health issue),',
    'portion (how much to eat at one sitting, in household measures),',
    'after_effects (probable after-effects, e.g. blood sugar spike, bloating),',
    'tip (one practical way to make it safer or better).',
  ].join('\n');
}

/* ---------- allergy hard-filter: code-level safety net, independent of the AI ---------- */
const splitList = (s) => (s || '').split(/[,;\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean)
  .filter((x) => !['none', 'no', 'nil', 'na', 'n/a'].includes(x));
const findAllergen = (text, allergens) => {
  const t = String(text).toLowerCase();
  return allergens.find((a) => t.includes(a) || (a.endsWith('s') && t.includes(a.slice(0, -1))));
};

/* ---------- model lifecycle ---------- */
async function load(modelFile, onStatus) {
  if (model) return;
  if (!loading) {
    loading = (async () => {
      if (!fs.existsSync(modelFile)) throw new Error('MODEL_MISSING');
      onStatus('Loading the model (first time takes a minute)...');
      const { getLlama } = await import('node-llama-cpp');
      llama = await getLlama({ build: 'never' });
      model = await llama.loadModel({ modelPath: modelFile });
      context = await model.createContext({ contextSize: 4096 });
    })().catch((e) => { loading = null; throw e; });
  }
  await loading;
}

async function ask(system, user, schema) {
  const { LlamaChatSession } = await import('node-llama-cpp');
  const grammar = await llama.createGrammarForJsonSchema(schema);
  // Fresh session per request => no chat history is kept
  const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: system });
  try {
    const text = await session.prompt(user, { grammar, maxTokens: 1800, temperature: 0.5 });
    return grammar.parse(text);
  } finally {
    session.dispose({ disposeSequence: true });
  }
}

async function doGenerate({ modelFile, profile, mode, input, onStatus }) {
  const allergens = splitList(profile.allergies);

  if (mode === 'check') {
    const hit = findAllergen(input.ingredients, allergens);
    if (hit) {
      return {
        ingredients: input.ingredients,
        verdict: VERDICTS[2],
        reason: `This dish contains "${hit}", which is on your allergy list.`,
        portion: 'None.',
        after_effects: 'Possible allergic reaction.',
        tip: 'Look for a version without it.',
      };
    }
  }

  await load(modelFile, onStatus);
  onStatus('Thinking...');
  const system = systemPrompt(profile);

  for (let attempt = 0; attempt < 3; attempt++) {
    let data;
    try {
      data = mode === 'meal'
        ? await ask(system, mealPrompt(input, attempt ? `Do NOT use: ${allergens.join(', ')}.` : ''), MEAL_SCHEMA)
        : await ask(system, checkPrompt(input), CHECK_SCHEMA);
    } catch (e) {
      if (attempt === 2) throw e;
      continue; // malformed / truncated JSON -> try again
    }

    if (mode === 'check') return { ingredients: input.ingredients, ...data };

    const safe = data.recipes
      .filter((r) => !findAllergen([r.name, ...r.ingredients].join(' '), allergens))
      .slice(0, 3);
    if (safe.length) return { recipes: safe };
  }
  throw new Error('ALLERGY_BLOCK');
}

function generate(opts) {
  const run = queue.then(() => doGenerate(opts));
  queue = run.catch(() => {});
  return run;
}

async function dispose() {
  try { if (context) await context.dispose(); if (model) await model.dispose(); } catch {}
}

function friendlyError(err) {
  const m = String(err && err.message);
  if (m.includes('MODEL_MISSING'))
    return 'The AI model file was not found. Put your .gguf file at models/model.gguf and restart.';
  if (m.includes('ALLERGY_BLOCK'))
    return 'I could not make a recipe that avoids your allergies from this stock. Try adding more ingredients.';
  return 'Something went wrong while generating. Please try again.';
}

module.exports = { generate, dispose, friendlyError };
