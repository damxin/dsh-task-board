/**
 * Standalone build config for the task-board plugin — BOTH faces.
 *
 * DSH loads this plugin twice, and the two artifacts have different contracts:
 *
 * - the HOST half (`lib/index.js`) is imported by the Host process as ESM. It
 *   bundles the whole board (ledger, runner, scheduler, tools) and keeps the
 *   SDK packages the Host runtime already provides external, so the host and
 *   the plugin share ONE instance of each;
 * - the CLIENT half (`lib/client.js`) is served to the web shell as a single
 *   script that registers itself through the shared module loader
 *   (`window.__ModuleLoader__.load({ id, factory })`). Its `require` resolves
 *   ONLY the shell's module table (react), so every other dependency is
 *   inlined — a second copy of a runtime library would break the identity the
 *   shell shares.
 *
 * CSS Modules are compiled by lightningcss inside the bundle: `x.module.css`
 * yields a hashed class map and injects a tagged `<style>` at factory
 * execution, because the shell loads no stylesheet for a plugin.
 *
 * This file is self-contained on purpose. The earlier build borrowed a
 * monorepo preset from outside this repository (`../../shared/tsdown.client.ts`),
 * which left the plugin unbuildable wherever that directory is absent — the
 * failure surfaced as a plugin that could not be activated at all, because the
 * host half was never emitted. The recipe below is the one the sibling plugins
 * of this family ship (dsh-web-tools, dsh-stockbench), and the artifact shape
 * is the one the published 0.4.6 package carries, so the DSH loader sees what
 * it expects.
 */
import { readFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'

/** The bundle id the shell's module loader registers this plugin under. */
const PLUGIN_ID = '@linxin666/dsh-client-ui-task-board'

/** This repository's root: the anchor for the CSS asset ids. */
const ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * Module specifiers the web shell shares into its frozen module table. The
 * client half's `require` can only answer these, so they stay external; every
 * other dependency is inlined.
 *
 * `dsh-client-store` is the staged-form store the settings card models its
 * drafts with: the shell owns the module table, so the plugin asks for the
 * shell's instance instead of carrying a second one.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-store',
]

/**
 * Packages the Host runtime provides to the plugin. The host and the plugin
 * must share ONE instance of each (a duplicated tool registry or cordis
 * service would be a second runtime), so they stay external in the host half.
 */
const HOST_EXTERNALS = [
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/schemastery',
]

/** Node builtins must never survive into the browser module-loader factory. */
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map(id => `node:${id}`),
])

/** A rolldown plugin as tsdown's config accepts it (contextual `this` for load/resolveId). */
type BuildPlugin = NonNullable<UserConfig['plugins']>

/**
 * The virtual-id wrapper that keeps module CSS away from the bundler's own CSS
 * pipeline. The suffix matters: a bundler guard matches ids ending in `.css`,
 * so the virtual id must not.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Emit one plugin-owned style injector and the CSS Modules class map.
 *
 * The class map is the module's default export (what `import css from
 * './x.module.css'` reads), and the stylesheet is injected once per id, so a
 * re-registered bundle does not stack duplicate `<style>` elements.
 * @param id - the plugin id the style tag is attributed to.
 * @param fileId - the stylesheet path, relative to the repository root.
 * @param css - the compiled stylesheet.
 * @param classMap - local class name -> hashed class name.
 * @returns the virtual module's source.
 */
function styleInjectionModule(id: string, fileId: string, css: string, classMap: Record<string, string>): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${fileId}`)};`,
    `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    `  tag.dataset.pluginCss = tagId;`,
    `  tag.textContent = css;`,
    `  document.head.appendChild(tag);`,
    `}`,
    `export default ${JSON.stringify(classMap)};`,
  ]
  return source.join('\n')
}

/**
 * Compile every `*.module.css` import into an inlined class map.
 *
 * The plugin's own stylesheets are the only CSS it owns: the shell loads no
 * stylesheet for a plugin, so the bundle has to carry them and inject them
 * itself. The hashed class names keep the board's generic selectors (`.card`,
 * `.select`, `.field`) from colliding with the shell's own styles.
 */
function cssModulesPlugin(): BuildPlugin {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const absolute = importer !== undefined ? resolve(dirname(importer), source) : resolve(source)
      // The virtual id stays relative to the repository root, so the artifact
      // (and its source map) never carries the build machine's absolute paths.
      return CSS_VIRTUAL_PREFIX + relative(ROOT, absolute).replaceAll('\\', '/') + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = resolve(ROOT, virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length))
      // The virtual id otherwise hides the physical stylesheet from the watch graph.
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      const entries = Object.entries(cssExports ?? {})
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      for (const [local, exported] of entries) classMap[local] = exported.name
      return styleInjectionModule(PLUGIN_ID, relative(ROOT, fileId).replaceAll('\\', '/'), code.toString(), classMap)
    },
  }
}

/**
 * The client bundle's purity gate: the browser half may only reach the shell's
 * module table and its own sources. A cross-plugin value import would either
 * inline a duplicate runtime instance or name a specifier the module table
 * cannot answer for — collaboration goes through cordis services instead.
 */
function purityGatePlugin(): BuildPlugin {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (NODE_BUILTINS.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table — `
          + 'select the dependency browser export or add an explicit browser implementation',
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not in the client externals (${CLIENT_EXTERNALS.join(', ')}) — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services '
        + '(type-only imports are erased and never reach this gate)',
      )
    },
  }
}

/** The environment defines both faces share. */
function buildDefines(): Record<string, string> {
  const mode = JSON.stringify(process.env.NODE_ENV ?? 'production')
  return {
    'process.env.NODE_ENV': mode,
    'import.meta.env.MODE': mode,
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    'import.meta.resolve': 'undefined',
  }
}

export default [
  // The HOST half: ESM, imported by the Host process.
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    dts: false,
    sourcemap: false,
    // clean stays off: the build script runs `tsc -b` for the declaration
    // files first, and a clean here would wipe the types it just emitted.
    clean: false,
    // The SDK packages the Host runtime provides stay external, so the host
    // and the plugin share one instance of each; everything else is inlined.
    deps: {
      neverBundle: [...HOST_EXTERNALS],
    },
    define: buildDefines(),
    outputOptions: {
      entryFileNames: 'index.js',
    },
  },
  // The CLIENT half: one CJS closure script the web shell loads.
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    // Platform module-table entries stay external (the loader's `require`
    // answers them at runtime); every other dependency is inlined.
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: (id: string) => (CLIENT_EXTERNALS.includes(id) ? false : true),
    },
    define: buildDefines(),
    // CJS output otherwise makes some transitive packages resolve their Node
    // entry even though this bundle runs in the browser. Keep browser
    // conditional exports authoritative for both source import() and
    // generated require() edges.
    inputOptions: {
      resolve: {
        conditionNames: ['browser', 'import', 'require', 'default'],
      },
    },
    plugins: [purityGatePlugin(), cssModulesPlugin()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: "${PLUGIN_ID}", factory: (require) => {`,
      footer: `return module.exports; } });`,
      intro: `var module = { exports: {} }; var exports = module.exports;`,
      // The CJS wrapper factory's `require` only resolves module-table entries
      // (react); it cannot load relative chunk URLs in the browser. Disable
      // code splitting so the artifact is one script.
      codeSplitting: false,
    },
  },
] satisfies UserConfig[]
