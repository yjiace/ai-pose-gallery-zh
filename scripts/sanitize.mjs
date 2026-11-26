#!/usr/bin/env node
/**
 * 基于 scripts/sanitize-map.json 对指定目标执行单遍精确敏感词脱敏替换。
 * - 按原词长度降序编译正则，确保长词优先匹配；
 * - 单遍正则扫描替换，确保不产生连环二次替换且幂等。
 *
 * 用法：
 *   node scripts/sanitize.mjs            # 默认处理 src、comfyui_plugin、data、skills
 *   node scripts/sanitize.mjs src data   # 仅处理指定目录或文件
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const DEFAULT_MAP_PATH = path.join(ROOT, 'scripts', 'sanitize-map.json')

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.json',
  '.csv',
  '.py',
  '.html',
  '.md',
])

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'img', 'thumbs'])

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function loadSanitizeMap(mapPath = DEFAULT_MAP_PATH) {
  return JSON.parse(fs.readFileSync(mapPath, 'utf8'))
}

export function createSanitizer(map = loadSanitizeMap()) {
  const keys = Object.keys(map).filter(Boolean).sort((a, b) => b.length - a.length)
  if (keys.length === 0) return (text) => text
  const pattern = new RegExp(keys.map(escapeRegExp).join('|'), 'g')
  return (text) => text.replace(pattern, (matched) => map[matched] ?? matched)
}

function collectFiles(targetPath, out = []) {
  if (!fs.existsSync(targetPath)) return out
  const stat = fs.statSync(targetPath)
  if (stat.isFile()) {
    if (TEXT_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) {
      out.push(targetPath)
    }
    return out
  }
  if (!stat.isDirectory()) return out
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    collectFiles(path.join(targetPath, entry.name), out)
  }
  return out
}

function main() {
  const args = process.argv.slice(2)
  const targets = (args.length > 0 ? args : ['src', 'comfyui_plugin', 'data', 'skills']).map((p) =>
    path.resolve(ROOT, p),
  )

  const sanitize = createSanitizer()
  const files = []
  for (const t of targets) {
    // 跳过映射表自身
    if (t === DEFAULT_MAP_PATH) continue
    collectFiles(t, files)
  }

  let changedCount = 0
  for (const file of files) {
    if (path.resolve(file) === DEFAULT_MAP_PATH) continue
    const raw = fs.readFileSync(file, 'utf8')
    const next = sanitize(raw)
    if (next !== raw) {
      fs.writeFileSync(file, next, 'utf8')
      changedCount++
    }
  }
  console.log(`Sanitized ${changedCount} file(s) out of ${files.length} scanned.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main()
}
