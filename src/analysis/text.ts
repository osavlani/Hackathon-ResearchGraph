// Tiny text utilities shared by search, similarity and the gap engine. No dependencies.

const STOP = new Set(
  'a an the of in on for to and or with without by from as at is are be been being that this these those its it their into via vs using use used than over under about can could may might model models llm llms language large ai'.split(' '),
);

/** crude English stemmer: enough to match faking/fake/fakes, evaluations/evaluation, deceptive/deception */
export function stem(w: string): string {
  let s = w.toLowerCase();
  for (const suf of ['ational', 'ations', 'ation', 'ively', 'ive', 'ing', 'ion', 'ers', 'er', 'ies', 'es', 'ed', 'ly', 's']) {
    if (s.length > suf.length + 3 && s.endsWith(suf)) {
      s = s.slice(0, -suf.length);
      break;
    }
  }
  // deceptive/deception -> decept ; deceive -> deceiv  (unify)
  if (s.startsWith('deceiv')) s = 'decept';
  return s;
}

export function tokens(text: string, keepStop = false): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
    .flatMap((t) => t.split('-'))
    .filter((t) => t.length > 1 && (keepStop || !STOP.has(t)))
    .map(stem);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
}
