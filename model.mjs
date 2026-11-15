/**
 * Sexual Representation Triangle — pure mathematical model.
 * Это условная система классификации, а не клинический или эмпирический тест.
 * Answer convention: 0 = feminine-coded option, 1 = masculine-coded option.
 */

export const EPS = 1e-9;

/** Full questionnaire vector, including disabled traits; independent of answer key order. */
export function partnerVectorKey(answers, traits) {
  return JSON.stringify(traits.map(t => answers?.[t.id]));
}

/** First saved profile owns the vector's explicit weight. Never sum duplicate weights. */
export function uniquePartnerProfiles(ideals, traits) {
  const seen = new Set();
  return ideals.filter(p => {
    const key = partnerVectorKey(p.answers, traits);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function evaluateIdentity(answers, traits) {
  const active = traits.filter(t => t.enabled && Number(t.weight) > 0);
  if (!active.length) return { ok: false, reason: 'Нет активных вопросов с положительными весами.' };
  let numerator = 0;
  let denominator = 0;
  for (const trait of active) {
    const answer = answers?.[trait.id];
    if (answer !== 0 && answer !== 1) {
      return { ok: false, reason: `Не выбран бинарный ответ на вопрос “${trait.question}”.` };
    }
    numerator += Number(trait.weight) * (2 * answer - 1);
    denominator += Number(trait.weight);
  }
  const value = numerator / denominator;
  if (Math.abs(value) < EPS) {
    return {
      ok: false,
      reason: 'Точный баланс даёт I = 0, что исключено аксиомой A0. Измените один из ответов или вес: модель не назначает сторону автоматически.',
      tie: true
    };
  }
  return { ok: true, value, numerator, denominator };
}

export function evaluateTriangle(ownAnswers, ideals, traits) {
  const own = evaluateIdentity(ownAnswers, traits);
  if (!own.ok) return { ok: false, context: 'Мои характеристики', reason: own.reason };

  const relevant = uniquePartnerProfiles(ideals, traits).filter(p => Number(p.weight) > 0);
  const totalWeight = relevant.reduce((sum, p) => sum + Number(p.weight), 0);
  if (!relevant.length || totalWeight <= EPS) {
    return { ok: false, context: 'Мои предпочтения', reason: 'Хотя бы один партнер должен иметь положительный вес предпочтения.' };
  }
  let mu = 0;
  let r = 0;
  const evaluated = [];
  for (const p of relevant) {
    const result = evaluateIdentity(p.answers, traits);
    if (!result.ok) return { ok: false, context: `Партнер “${p.name}”`, reason: result.reason };
    const probability = Number(p.weight) / totalWeight;
    mu += probability * result.value;
    r += probability * Math.abs(result.value);
    evaluated.push({ id: p.id, name: p.name, identity: result.value, probability });
  }

  // Math: 0 <= |mu| <= r <= 1. b measures opposing preference polarization.
  const both = Math.max(0, Math.min(1, r - Math.abs(mu)));
  const signed = own.value * mu;
  const homo = (1 - both + signed) / 2;
  const hetero = (1 - both - signed) / 2;
  return {
    ok: true,
    a: own.value,
    mu,
    r,
    both,
    signed,
    homo,
    hetero,
    evaluated
  };
}

export function allAnswers(traits, value) {
  return Object.fromEntries(traits.map(t => [t.id, value]));
}

/** Find a realizable binary vector with the smallest nonzero signed I of a chosen sign. */
export function nearestToZero(traits, sign = 1) {
  const active = traits.filter(t => t.enabled && Number(t.weight) > 0);
  if (!active.length) return allAnswers(traits, sign > 0 ? 1 : 0);
  // Exact enumeration for the usual small questionnaire; hill climbing for custom sets > 19.
  const defaultAnswer = sign > 0 ? 1 : 0;
  let best = allAnswers(traits, defaultAnswer);
  let bestAbs = Infinity;
  if (active.length <= 19) {
    const count = 2 ** active.length;
    const total = active.reduce((sum, t) => sum + Number(t.weight), 0);
    for (let mask = 0; mask < count; mask++) {
      let sum = 0;
      for (let i = 0; i < active.length; i++) {
        sum += Number(active[i].weight) * ((Math.floor(mask / (2 ** i)) % 2) ? 1 : -1);
      }
      const result = sum / total;
      if (result * sign > EPS && Math.abs(result) < bestAbs) {
        bestAbs = Math.abs(result);
        best = allAnswers(traits, defaultAnswer);
        for (let i = 0; i < active.length; i++) best[active[i].id] = Math.floor(mask / (2 ** i)) % 2;
      }
    }
  } else {
    // Deterministic greedy approximation: move towards 0 without crossing it.
    const sorted = [...active].sort((a, b) => Number(b.weight) - Number(a.weight));
    const total = sorted.reduce((s, t) => s + Number(t.weight), 0);
    let signedSum = sign * total;
    for (const t of sorted) {
      const next = signedSum - 2 * sign * Number(t.weight);
      if (next * sign > EPS && Math.abs(next) < Math.abs(signedSum)) {
        signedSum = next;
        best[t.id] = 1 - defaultAnswer;
      }
    }
  }
  return best;
}
