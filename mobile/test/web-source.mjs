// Reads the PWA's own sources (web/src), for test/web-sync.test.mjs. The web's
// strings are object literals inside a React module that isn't meant to be
// imported here (it reads the browser on load): they are parsed with the
// TypeScript compiler instead, literal by literal.

import { readFileSync } from 'node:fs'
import ts from 'typescript'

const WEB = new URL('../../web/src/', import.meta.url)

function parse(path) {
  return ts.createSourceFile(path, readFileSync(new URL(path, WEB), 'utf8'), ts.ScriptTarget.Latest, true)
}

/** The value of a literal expression: strings, numbers, booleans, arrays and objects. */
function literal(node) {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    node = node.expression
  }
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal)
  if (ts.isObjectLiteralExpression(node)) {
    const out = {}
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) throw new Error(`Not a plain property: ${prop.getText()}`)
      const name = ts.isIdentifier(prop.name) ? prop.name.text : literal(prop.name)
      out[name] = literal(prop.initializer)
    }
    return out
  }
  throw new Error(`Not a literal: ${node.getText()}`)
}

/** The initializers of the top-level `const` declarations named in `names`. */
function constants(file, names) {
  const found = {}
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && names.includes(decl.name.text) && decl.initializer) {
        found[decl.name.text] = literal(decl.initializer)
      }
    }
  }
  for (const name of names) if (!(name in found)) throw new Error(`${file.fileName}: no const ${name}`)
  return found
}

/** The PWA's strings, `{ nl, fr, en }`, from web/src/lib/i18n.tsx. */
export function webMessages() {
  return constants(parse('lib/i18n.tsx'), ['nl', 'fr', 'en'])
}

/** `TAG_KEYS` and `TAGS` from web/src/lib/tags.ts. */
export function webTags() {
  return constants(parse('lib/tags.ts'), ['TAG_KEYS', 'TAGS'])
}

/** The design tokens' colours from web/src/styles/tokens.css: `--berry-deep` becomes `berryDeep`. */
export function webColorTokens() {
  const css = readFileSync(new URL('styles/tokens.css', WEB), 'utf8')
  const tokens = {}
  for (const [, name, value] of css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value.toLowerCase()
  }
  return tokens
}
