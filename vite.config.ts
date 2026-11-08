import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { checkGraphIntegrity } from './scripts/graph-integrity.ts'

/**
 * Build-time integrity gate. Hashes public/graph.json and checks that public/grounding.json (citation and
 * PDF-match data) was produced for exactly that graph. A production build fails on a mismatch, so a stale
 * pairing can never be shipped; the dev server only warns. The fingerprint is written to
 * dist/graph-integrity.json for the record. The app still re-hashes the graph it actually loads at runtime.
 */
function graphIntegrity(): Plugin {
  const publicDir = resolve(process.cwd(), 'public')
  let command: 'build' | 'serve' = 'serve'
  return {
    name: 'graph-integrity',
    configResolved(cfg) {
      command = cfg.command
    },
    buildStart() {
      const r = checkGraphIntegrity(publicDir)
      if (r.match) return
      const msg = `public/grounding.json was produced for graph ${r.groundingGraphSha256}, but public/graph.json is ${r.graphSha256}. Re-run scripts/grounding/pipeline.py and export_frontend.py.`
      if (command === 'build') this.error(msg)
      else this.warn(msg)
    },
    generateBundle() {
      if (command !== 'build') return
      this.emitFile({ type: 'asset', fileName: 'graph-integrity.json', source: JSON.stringify(checkGraphIntegrity(publicDir), null, 2) + '\n' })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), graphIntegrity()],
})
