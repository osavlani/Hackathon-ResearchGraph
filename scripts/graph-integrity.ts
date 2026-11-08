import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GraphIntegrity {
  graphSha256: string;
  groundingPresent: boolean;
  groundingGraphSha256: string | null;
  /** true when there is no grounding file, or it was produced for exactly this graph */
  match: boolean;
}

/** Hash <publicDir>/graph.json and compare it with the graph hash recorded in <publicDir>/grounding.json. */
export function checkGraphIntegrity(publicDir: string): GraphIntegrity {
  const graphSha256 = createHash('sha256').update(readFileSync(join(publicDir, 'graph.json'))).digest('hex');
  const gp = join(publicDir, 'grounding.json');
  const grounding = existsSync(gp) ? (JSON.parse(readFileSync(gp, 'utf8')) as { graphSha256?: string }) : null;
  return {
    graphSha256,
    groundingPresent: !!grounding,
    groundingGraphSha256: grounding?.graphSha256 ?? null,
    match: !grounding || grounding.graphSha256 === graphSha256,
  };
}
