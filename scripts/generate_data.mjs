#!/usr/bin/env node
/**
 * 基于 scripts/i18n.py 与 data/charadb/names-zh.json 生成脱敏后的全部中文数据集：
 * - data/pose-zh.json / data/meta-zh.json
 * - data/costume-zh.json / data/costume-meta-zh.json
 * - data/portrait-zh.json / data/portrait-meta-zh.json
 * - data/costume-anime-zh.json
 * - data/costume-gia-anime-zh.json
 * - data/manifest.json
 * - data/translations.csv
 * - skills/costume-reference-anime/references/catalog.csv
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve(import.meta.dirname, '..')
const DATA = path.join(ROOT, 'data')

// 解析 scripts/i18n.py 中的字典定义
const i18nSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'i18n.py'), 'utf8')

function extractPyDict(name) {
  const re = new RegExp(`^${name}\\s*=\\s*\\{([\\s\\S]*?)^\\}`, 'm')
  const m = i18nSrc.match(re)
  if (!m) throw new Error(`Cannot find dict ${name} in scripts/i18n.py`)
  const out = {}
  const entryRe = /"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  let em
  while ((em = entryRe.exec(m[1])) !== null) {
    out[JSON.parse(`"${em[1]}"`)] = JSON.parse(`"${em[2]}"`)
  }
  return out
}

const SYSTEM = extractPyDict('SYSTEM')
const CATEGORY = extractPyDict('CATEGORY')
const ANGLE = extractPyDict('ANGLE')
const POSE = extractPyDict('POSE')
const COSTUME_CATEGORY = extractPyDict('COSTUME_CATEGORY')
const COSTUME_COLORS = extractPyDict('COSTUME_COLORS')
const COSTUME_MODIFIERS = extractPyDict('COSTUME_MODIFIERS')
const COSTUME_NOUNS = extractPyDict('COSTUME_NOUNS')
const COSTUME_WORD_ALL = { ...COSTUME_COLORS, ...COSTUME_MODIFIERS, ...COSTUME_NOUNS }
const PORTRAIT_SECTION = extractPyDict('PORTRAIT_SECTION')
const PORTRAIT_HAIR = extractPyDict('PORTRAIT_HAIR')
const PORTRAIT_STYLE = extractPyDict('PORTRAIT_STYLE')

function translateCostumeKeywords(kw) {
  const tokens = kw.trim().split(/\s+/).filter(Boolean)
  const merged = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    const nxt = tokens[i + 1] ?? null
    const nxt2 = tokens[i + 2] ?? null
    if ((t === 'olive' || t === 'mint') && nxt === 'green') {
      merged.push(t)
      i += 2
    } else if (t === 'bra' && nxt === 'briefs') {
      merged.push('bra_briefs')
      i += 2
    } else if (t === 'shirt' && nxt === 'dress') {
      merged.push('shirt_dress')
      i += 2
    } else if (t === 'shirt' && nxt === 'jacket') {
      merged.push('shirt_jacket')
      i += 2
    } else if (t === 'skirt' && nxt === 'shorts') {
      merged.push('skirt_shorts')
      i += 2
    } else if (
      t === 'ribbon' &&
      ['chiffon', 'shirt', 'blouse', 'camisole', 'dress', 'knit', 'cardigan', 'sweater', 'skirt'].includes(nxt)
    ) {
      merged.push('ribbon_mod')
      i += 1
    } else if (t === 'camisole' && ['dress', 'mini', 'midi', 'maxi'].includes(nxt)) {
      merged.push('camisole_mod')
      i += 1
    } else if (t === 'corset' && ['dress', 'mini', 'midi', 'maxi', 'skirt'].includes(nxt)) {
      merged.push('corset_mod')
      i += 1
    } else if (
      t === 'knit' &&
      !['dress', 'cardigan', 'sweater', 'vest', 'beanie', 'skirt', 'shorts', 'pants', 'camisole', 'turtleneck'].includes(nxt) &&
      !(['mini', 'midi', 'maxi'].includes(nxt) && nxt2 === 'dress')
    ) {
      merged.push('knit_top')
      i += 1
    } else if (
      t === 'turtleneck' &&
      !['dress', 'sweater', 'knit'].includes(nxt) &&
      !(['mini', 'midi', 'maxi'].includes(nxt) && nxt2 === 'dress')
    ) {
      merged.push('turtleneck_top')
      i += 1
    } else {
      merged.push(t)
      i += 1
    }
  }

  const extMods = { ...COSTUME_MODIFIERS, ribbon_mod: '蝴蝶结', camisole_mod: '吊带', corset_mod: '束腰' }
  const extNouns = {
    ...COSTUME_NOUNS,
    bra_briefs: '贴身套装',
    shirt_dress: '衬衫裙',
    shirt_jacket: '衬衫夹克',
    skirt_shorts: '裙裤',
    knit_top: '针织衫',
    turtleneck_top: '高领衫',
  }

  const modValues = new Set(Object.values(extMods))
  const colorValues = new Set(Object.values(COSTUME_COLORS))
  const decoEnds = ['蕾丝', '荷叶边', '薄纱', '网纱', '缎面']

  const phrases = []
  let buf = []
  for (const t of merged) {
    if (t in extNouns) {
      phrases.push(buf.join('') + extNouns[t])
      buf = []
    } else if (t in COSTUME_COLORS) {
      if (buf.some((x) => modValues.has(x))) {
        let s = buf.join('')
        if (decoEnds.some((e) => s.endsWith(e))) s += '饰边'
        phrases.push(s)
        buf = [COSTUME_COLORS[t]]
      } else {
        buf.push(COSTUME_COLORS[t])
      }
    } else if (t in extMods) {
      buf.push(extMods[t])
    } else {
      throw new Error(`Unknown costume token: ${t}`)
    }
  }
  if (buf.length > 0) {
    let s = buf.join('')
    if (s === '金色' || s === '银色') s += '饰品'
    else if (s.endsWith('迷你')) s += '包'
    else if (decoEnds.some((e) => s.endsWith(e))) s += '配饰'
    else if (colorValues.has(s)) s += '配饰'
    phrases.push(s)
  }

  const wordTags = []
  for (const w of tokens) {
    const zh = COSTUME_WORD_ALL[w]
    if (!wordTags.includes(zh)) wordTags.push(zh)
  }
  return [phrases.join('・'), wordTags]
}

// 1. POSE 翻译
const poseData = JSON.parse(fs.readFileSync(path.join(DATA, 'pose.json'), 'utf8'))
const poseMeta = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'))

const poseOut = poseData.map((x) => ({
  id: x.id,
  体系: SYSTEM[x['系統']],
  姿势编号: x['ポーズ番号'],
  分类: CATEGORY[x['分類']],
  姿势名称: POSE[x['ポーズ名']],
  角度: ANGLE[x['アングル']],
  缩略图: x['サムネ'],
  原图: x['原寸'],
  敏感: x['系統'] === '全身1人・セクシー系' || x['系統'] === '2人絡み',
  检索: `${x.id} ${SYSTEM[x['系統']]}${CATEGORY[x['分類']]}${POSE[x['ポーズ名']]}${ANGLE[x['アングル']]}`,
}))

fs.writeFileSync(path.join(DATA, 'pose-zh.json'), JSON.stringify(poseOut, null, 1), 'utf8')
fs.writeFileSync(
  path.join(DATA, 'meta-zh.json'),
  JSON.stringify({ 体系分类: poseMeta.lines.map((s) => SYSTEM[s]) }, null, 2),
  'utf8',
)

// 2. COSTUME 翻译
const costumeData = JSON.parse(fs.readFileSync(path.join(DATA, 'costume.json'), 'utf8'))
const costumeMeta = JSON.parse(fs.readFileSync(path.join(DATA, 'costume-meta.json'), 'utf8'))

const costumeOut = costumeData.map((x) => {
  const cid = x.id
  const catZh = COSTUME_CATEGORY[x['カテゴリ']]
  const [nameZh, tagsZh] = translateCostumeKeywords(x['キーワード'])
  const thumbRel = `thumbs/costume/${cid}.webp`
  const imgRel = `img/costume/${cid}.webp`
  return {
    id: cid,
    分类: catZh,
    服装名称: nameZh,
    标签: tagsZh,
    关键词: x['キーワード'],
    缩略图: thumbRel,
    预览图: imgRel,
    原图: imgRel,
    敏感: x['カテゴリ'] === 'ランジェリー' || x['カテゴリ'] === 'セクシー',
    检索: `${cid} ${catZh} ${nameZh} ${tagsZh.join(' ')} ${x['キーワード']}`,
  }
})

fs.writeFileSync(path.join(DATA, 'costume-zh.json'), JSON.stringify(costumeOut, null, 1), 'utf8')
const costumeCounts = {}
for (const [k, v] of Object.entries(costumeMeta.counts)) {
  costumeCounts[COSTUME_CATEGORY[k]] = v
}
fs.writeFileSync(
  path.join(DATA, 'costume-meta-zh.json'),
  JSON.stringify(
    {
      total: costumeMeta.total,
      分类列表: costumeMeta.cats.map((c) => COSTUME_CATEGORY[c]),
      各分类数量: costumeCounts,
    },
    null,
    2,
  ),
  'utf8',
)

// 3. PORTRAIT 翻译
const portraitData = JSON.parse(fs.readFileSync(path.join(DATA, 'portrait.json'), 'utf8'))
const portraitRank = JSON.parse(fs.readFileSync(path.join(DATA, 'portrait-ranking.json'), 'utf8'))
const rankSet = new Set(portraitRank?.top?.['総合'] || [])

const portraitOut = portraitData.map((x) => {
  const pid = x.id
  const secZh = PORTRAIT_SECTION[x.section]
  const hairZh = PORTRAIT_HAIR[x.hair]
  const rawStyle = x.style || ''
  const styleZh = PORTRAIT_STYLE[rawStyle]
  let titleZh
  if (!rawStyle) titleZh = `${hairZh}・标准款`
  else if (styleZh.includes(hairZh)) titleZh = styleZh
  else titleZh = `${hairZh}・${styleZh}`

  return {
    id: pid,
    分区: secZh,
    发长: hairZh,
    发型名称: styleZh,
    标题: titleZh,
    宽: x.w,
    高: x.h,
    字节数: x.bytes || 0,
    精选: Boolean(x.hero),
    热门: rankSet.has(pid),
    缩略图: `thumbs/portrait/${pid}.webp`,
    原图: `img/portrait/${pid}.webp`,
    检索: `${pid} ${secZh} ${hairZh} ${styleZh}`,
  }
})

fs.writeFileSync(path.join(DATA, 'portrait-zh.json'), JSON.stringify(portraitOut, null, 1), 'utf8')
const rankTop = {}
for (const [k, v] of Object.entries(portraitRank.top || {})) {
  rankTop[PORTRAIT_HAIR[k]] = v
}
fs.writeFileSync(
  path.join(DATA, 'portrait-meta-zh.json'),
  JSON.stringify(
    {
      total: portraitOut.length,
      分区列表: [PORTRAIT_SECTION.face, PORTRAIT_SECTION.styling],
      发长列表: ['ショート', 'ミディアム', 'セミロング', 'ロング'].map((h) => PORTRAIT_HAIR[h]),
      排行榜分类: (portraitRank.cats || []).map((c) => PORTRAIT_HAIR[c]),
      排行榜Top10: rankTop,
    },
    null,
    2,
  ),
  'utf8',
)

// 4. CharaDB 二次元服装翻译
const charaDir = path.join(DATA, 'charadb')
const charaNames = JSON.parse(fs.readFileSync(path.join(charaDir, 'names-zh.json'), 'utf8'))
const charaOutfits = JSON.parse(fs.readFileSync(path.join(charaDir, 'outfits-public.json'), 'utf8'))
const charaSource = JSON.parse(fs.readFileSync(path.join(charaDir, 'source.json'), 'utf8'))
const ORIGIN = 'https://charadb-2fi.pages.dev'
const TAG_NAMES = {
  ...COSTUME_WORD_ALL,
  serafuku: '水手服',
  blazer: '西装外套',
  kimono: '和服',
  yukata: '浴衣',
  bikini: '比基尼',
  bodysuit: '紧身衣',
  armor: '护甲',
  uniform: '制服',
  maid: '女仆',
  pajamas: '睡衣',
  necktie: '领带',
  bow: '蝴蝶结',
  frills: '荷叶边',
  plaid: '格纹',
  sleeveless: '无袖',
  striped: '条纹',
  backless: '露背',
  'off-shoulder': '露肩',
  leotard: '紧身连体衣',
  thighhighs: '过膝袜',
  pantyhose: '连裤袜',
  corset: '束腰',
}
const CHARA_CATEGORIES = {
  '制服・学生': '制服与校园风',
  'カジュアル(春夏)': '春夏休闲',
  'カジュアル(秋冬)': '秋冬休闲',
  'きれいめ・オフィス': '通勤与职场',
  'ドレス・パーティ': '礼服与派对',
  和服: '和服',
  水着: '泳装',
  'スポーツ・部活': '运动',
  '職業・コスプレ': '职业与角色扮演',
  ファンタジー: '奇幻',
  '部屋着・パジャマ': '居家与睡衣',
  'イベント・季節': '节庆与季节',
  'アイドル・ステージ': '偶像与舞台',
  'ゴスロリ・地雷系': '洛丽塔与地雷系',
  'ミリタリー・SF': '军事与科幻',
}

const charaOut = charaOutfits.map((row) => {
  const rid = row.id
  const name = charaNames[rid]
  const category = CHARA_CATEGORIES[row.cat]
  const tags = row.tags
  const sensitive =
    row.cat === '水着' ||
    /bikini|swimsuit|playboy bunny|cleavage|see-through|micro bikini|underwear|lingerie|succubus|naked/.test(tags)
  const words = tags.match(/[a-z]+(?:-[a-z]+)*/g) || []
  const labels = [...new Set([category, ...words.filter((w) => w in TAG_NAMES).map((w) => TAG_NAMES[w])])]
  return {
    id: `charadb-${rid}`,
    source: 'charadb',
    一级分类: '二次元',
    分类: category,
    服装名称: name,
    标签: labels,
    关键词: tags,
    缩略图: `${ORIGIN}/thumb/${rid}.webp`,
    预览图: `${ORIGIN}/img/${rid}.jpg`,
    原图: `${ORIGIN}/img/${rid}.jpg`,
    来源: 'たき AI · CharaDB',
    来源地址: `${ORIGIN}/`,
    敏感: sensitive,
    检索: `charadb-${rid} ${name} ${category} ${tags}`,
  }
})

fs.writeFileSync(path.join(DATA, 'costume-anime-zh.json'), JSON.stringify(charaOut, null, 2) + '\n', 'utf8')

// 5. ギア · 动漫服装翻译（复用已脱敏的 costumeOut）
const ANIME_ORIGIN = 'https://ai-costume-anime-gallery.pages.dev/'
const giaAnimeSnapPath = path.join(DATA, 'gia-anime', 'costume-anime.json')
let giaAnimeOut = []
if (fs.existsSync(giaAnimeSnapPath)) {
  const snapBuf = fs.readFileSync(giaAnimeSnapPath)
  const snapSha = crypto.createHash('sha256').update(snapBuf).digest('hex')
  if (snapSha !== '7a6b353c2a57ed6064863553fb122d6cc732e4f390d6babd46d0e81f14d47f87') {
    throw new Error('gia-anime 快照哈希不符，请先审核上游修订')
  }
  const baseById = new Map(costumeOut.map((r) => [r.id, r]))
  const rows = JSON.parse(snapBuf.toString('utf8'))
  giaAnimeOut = rows.map((row) => {
    const rid = row.id
    const local = baseById.get(rid)
    if (!local) throw new Error(`Missing base costume for ${rid}`)
    return {
      ...local,
      id: `gia-anime-${rid}`,
      source: 'gia-anime',
      一级分类: '二次元',
      来源: 'ギア · 动漫服装',
      来源地址: ANIME_ORIGIN,
      缩略图: `${ANIME_ORIGIN}thumbs/${rid}.webp`,
      预览图: `${ANIME_ORIGIN}img/${rid}.webp`,
      原图: `${ANIME_ORIGIN}png/${rid}.png`,
      检索: `${local['检索']} gia-anime ${rid} ギア 动漫`,
    }
  })
  fs.writeFileSync(path.join(DATA, 'costume-gia-anime-zh.json'), JSON.stringify(giaAnimeOut, null, 2) + '\n', 'utf8')
}

const csvEscape = (v) => {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// 更新 data/translations.csv
const countBy = (arr, fn) => {
  const m = new Map()
  for (const item of arr) {
    const k = fn(item)
    m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}

const csvRows = [['字段', '原文', '中文译文', '出现次数'].join(',')]
const poseFieldDefs = [
  ['系統', '系統', SYSTEM],
  ['分類', '分類', CATEGORY],
  ['角度', 'アングル', ANGLE],
  ['ポーズ名', 'ポーズ名', POSE],
]
for (const [label, field, dict] of poseFieldDefs) {
  const cnt = countBy(poseData, (x) => x[field])
  for (const jp of Object.keys(dict).sort()) {
    csvRows.push([`姿势:${label}`, jp, dict[jp], cnt.get(jp) || 0].map(csvEscape).join(','))
  }
}

const catCnt = countBy(costumeData, (x) => x['カテゴリ'])
for (const jp of Object.keys(COSTUME_CATEGORY).sort()) {
  csvRows.push(['服装:分类', jp, COSTUME_CATEGORY[jp], catCnt.get(jp) || 0].map(csvEscape).join(','))
}
const wordCnt = new Map()
for (const x of costumeData) {
  for (const w of x['キーワード'].trim().split(/\s+/)) {
    wordCnt.set(w, (wordCnt.get(w) || 0) + 1)
  }
}
for (const en of Object.keys(COSTUME_WORD_ALL).sort()) {
  csvRows.push(['服装:词条', en, COSTUME_WORD_ALL[en], wordCnt.get(en) || 0].map(csvEscape).join(','))
}

const secCnt = countBy(portraitData, (x) => x.section)
for (const en of Object.keys(PORTRAIT_SECTION).sort()) {
  csvRows.push(['人像:分区', en, PORTRAIT_SECTION[en], secCnt.get(en) || 0].map(csvEscape).join(','))
}
const hairCnt = countBy(portraitData, (x) => x.hair)
for (const jp of Object.keys(PORTRAIT_HAIR).sort()) {
  if (hairCnt.has(jp)) {
    csvRows.push(['人像:发长', jp, PORTRAIT_HAIR[jp], hairCnt.get(jp) || 0].map(csvEscape).join(','))
  }
}
const styleCnt = countBy(portraitData, (x) => x.style || '')
for (const jp of Object.keys(PORTRAIT_STYLE).sort()) {
  csvRows.push(['人像:发型', jp || '(空/默认)', PORTRAIT_STYLE[jp], styleCnt.get(jp) || 0].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(DATA, 'translations.csv'), '\uFEFF' + csvRows.join('\r\n') + '\r\n', 'utf8')

// 更新 skills/costume-reference-anime/references/catalog.csv
const catalogPath = path.join(ROOT, 'skills', 'costume-reference-anime', 'references', 'catalog.csv')
if (fs.existsSync(path.dirname(catalogPath))) {
  const lines = [['ID', '服装名称', '分类', '英文关键词', '图片URL', '敏感', '来源'].join(',')]
  for (const r of charaOut) {
    lines.push([r.id, r['服装名称'], r['分类'], r['关键词'], r['原图'], r['敏感'] ? 'True' : 'False', r['来源地址']].map(csvEscape).join(','))
  }
  fs.writeFileSync(catalogPath, lines.join('\r\n') + '\r\n', 'utf8')
}

// 6. 自动扫描 data/*-zh.json、执行兜底敏感词净化，并生成远程配置中心 data/manifest.json
const FALLBACK_SANITIZE_RULES = [
  ['全身1人・性感系', '全身1人・魅力写真'],
  ['双人缠绵', '双人互动'],
  ['内衣・睡衣', '居家・贴身穿搭'],
  ['性感穿搭', '魅力穿搭'],
  ['束腰胸衣', '塑身束腰'],
  ['低胸装', '深V领装'],
  ['低胸', '深V领'],
  ['露乳沟', '深V领'],
  ['文胸', '贴身背心'],
  ['胸罩', '贴身背心'],
  ['内裤', '贴身短裤'],
  ['内衣', '贴身衣物'],
  ['情趣', '魅力'],
  ['魅魔', '恶魔风'],
  ['性感', '魅力'],
  ['缠绵', '互动'],
]

function sanitizeJsonText(rawText) {
  let out = rawText
  for (const [from, to] of FALLBACK_SANITIZE_RULES) {
    if (out.includes(from)) out = out.split(from).join(to)
  }
  return out
}

const KNOWN_SOURCE_LABELS = {
  gia: '现实穿搭',
  shisei: '中国历代',
  charadb: '二次元·CharaDB',
  'gia-anime': '二次元·ギア',
}

const FILE_SORT_ORDER = [
  'portrait-zh.json',
  'costume-zh.json',
  'costume-shisei-zh.json',
  'costume-anime-zh.json',
  'costume-gia-anime-zh.json',
  'pose-zh.json',
]

const allZhFiles = fs
  .readdirSync(DATA)
  .filter((f) => f.endsWith('-zh.json') && !f.endsWith('meta-zh.json'))
  .sort((a, b) => {
    const ia = FILE_SORT_ORDER.indexOf(a)
    const ib = FILE_SORT_ORDER.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })

const sourceLabels = { ...KNOWN_SOURCE_LABELS }
const libGroups = {
  face: { label: '脸', filters: ['分区', '发长'], files: [] },
  costume: { label: '服装', filters: ['分类', '大类'], files: [] },
  pose: { label: '姿势', filters: ['动作分类', '体系'], files: [] },
}

for (const fileName of allZhFiles) {
  const fullPath = path.join(DATA, fileName)
  const rawText = fs.readFileSync(fullPath, 'utf8')
  const cleanText = sanitizeJsonText(rawText)
  if (cleanText !== rawText) {
    fs.writeFileSync(fullPath, cleanText, 'utf8')
  }
  const fileHash = crypto.createHash('sha256').update(cleanText).digest('hex').slice(0, 12)
  const records = JSON.parse(cleanText)
  const sample = Array.isArray(records) && records.length > 0 ? records[0] : {}

  let targetLib = null
  if (fileName.startsWith('portrait')) targetLib = 'face'
  else if (fileName.startsWith('costume')) targetLib = 'costume'
  else if (fileName.startsWith('pose')) targetLib = 'pose'
  if (!targetLib) continue

  const entry = {
    path: `data/${fileName}`,
    hash: fileHash,
    count: Array.isArray(records) ? records.length : 0,
  }

  if (targetLib === 'costume') {
    const srcKey = sample.source || (fileName === 'costume-zh.json' ? 'gia' : fileName.replace(/^costume-|-zh\.json$/g, ''))
    const inferredLabel =
      KNOWN_SOURCE_LABELS[srcKey] ||
      sample['大类'] ||
      sample['来源'] ||
      (sample['一级分类'] === '二次元' ? `二次元·${srcKey}` : sample['分类'] || '现实穿搭')
    sourceLabels[srcKey] = inferredLabel
    entry.source = srcKey
    entry.cat2 = inferredLabel
  }

  libGroups[targetLib].files.push(entry)
}

for (const lib of Object.values(libGroups)) {
  const combined = lib.files.map((f) => `${f.path}:${f.hash}`).join('|')
  lib.hash = crypto.createHash('sha256').update(combined).digest('hex').slice(0, 12)
}

const manifest = {
  schemaVersion: 1,
  nsfwPattern: '魅力写真|双人互动|贴身穿搭|魅力穿搭|睡衣|泳装',
  sourceLabels,
  libraries: libGroups,
  mapping: { pose: {}, costume: {}, face: {} },
}

fs.writeFileSync(path.join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

console.log(`OK 姿势记录数: ${poseOut.length}, 服装记录数: ${costumeOut.length}, 二次元服装(CharaDB): ${charaOut.length}, 二次元服装(ギア): ${giaAnimeOut.length}, 人像记录数: ${portraitOut.length}, 清单分库: ${Object.keys(libGroups).length}`)
