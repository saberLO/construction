/**
 * threeTzArchive.js — .3tz (3D Tiles Archive) 解析器
 *
 * .3tz 是一个 ZIP 格式的 3D Tiles 容器，通常由 ArcGIS / DJI Terra 等软件导出。
 * 内部包含:
 *   - tileset.json (根瓦片集描述)
 *   - *.b3dm / *.i3dm / *.pnts / *.cmpt / *.glb / *.gltf (瓦片内容)
 *   - 纹理图片、子瓦片集 JSON 等辅助资源
 *
 * 本模块将 .3tz 解压到内存，为所有文件创建 Blob URL，
 * 并按依赖深度从叶到根重写 JSON 中的相对路径为 Blob URL，
 * 使 3d-tiles-renderer 能以纯客户端方式直接渲染归档内容。
 *
 * 注意：使用 fflate 的异步 unzip（内部基于 Web Worker），
 * 避免大文件解压时阻塞主线程导致页面无响应。
 */

import { unzip, gunzipSync } from 'fflate'
import { fixLegacyB3dm, getB3dmGlbVersion, getGlbVersion } from './b3dm.js'

/* ─── MIME 猜测 ────────────────────────────────────────────── */

const MIME_MAP = {
  '.json':  'application/json',
  '.b3dm':  'application/octet-stream',
  '.i3dm':  'application/octet-stream',
  '.pnts':  'application/octet-stream',
  '.cmpt':  'application/octet-stream',
  '.glb':   'model/gltf-binary',
  '.gltf':  'model/gltf+json',
  '.bin':   'application/octet-stream',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.webp':  'image/webp',
  '.ktx2':  'image/ktx2',
  '.subtree': 'application/octet-stream',
}

function guessMime(path) {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_MAP[path.substring(dot).toLowerCase()] || 'application/octet-stream'
}

/* ─── Gzip 检测 ───────────────────────────────────────────── */

/** 检查数据是否为 gzip 压缩（魔术字节 0x1f 0x8b） */
function isGzipped(data) {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b
}

/** 如果数据被 gzip 压缩则解压，否则原样返回 */
function maybeGunzip(data) {
  if (isGzipped(data)) {
    try {
      return gunzipSync(data)
    } catch (e) {
      console.warn('[3tz] gzip 解压失败，使用原始数据:', e.message)
      return data
    }
  }
  return data
}

/* ─── 路径工具 ──────────────────────────────────────────────── */

/** 统一路径分隔符，去除前导 ./ */
function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

/** 取路径的目录部分（含尾部斜杠）*/
function pathDir(p) {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.substring(0, i + 1) : ''
}

/** 基于目录 baseDir 解析相对路径 relPath */
function resolveRelative(baseDir, relPath) {
  const rel = relPath.replace(/^\.\//, '')
  if (!baseDir) return normalizePath(rel)

  const parts = baseDir.replace(/\/$/, '').split('/')
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

/* ─── 让步工具 ──────────────────────────────────────────────── */

/** 让出主线程控制权，防止长时间占用导致页面无响应 */
function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/* ─── 虚拟网络层 (Monkey Patch fetch) ─────────────────────────── */

// 全局 Map，映射 'http://3tz-virtual.local/[uuid]/[path]' -> blobUrl
if (!window.__3tzVirtualPaths) {
  window.__3tzVirtualPaths = new Map()

  const originalFetch = window.fetch
  window.fetch = async function (input, init) {
    const urlStr = typeof input === 'string' ? input : (input instanceof Request ? input.url : '')
    
    if (urlStr.startsWith('http://3tz-virtual.local/')) {
      // 剥离 query 参数或 hash 避免找不到（虽然 local 系统很少有）
      const cleanUrl = urlStr.split('?')[0].split('#')[0]
      const blobUrl = window.__3tzVirtualPaths.get(cleanUrl)
      
      if (blobUrl) {
        return originalFetch(blobUrl, init)
      } else {
        console.warn('[3tz] 拦截到未知请求:', cleanUrl)
        return new Response('Not found in 3tz archive', { status: 404 })
      }
    }
    return originalFetch(input, init)
  }
}

/** 生成唯一 ID */
function generateUUID() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
}

/* ─── 主入口 ───────────────────────────────────────────────── */

/**
 * 解析 .3tz 文件并生成可供 TilesRenderer 直接使用的 rootUrl。
 *
 * @param {File} file           用户选取的 .3tz 文件
 * @param {(msg:string, pct:number)=>void} onProgress  进度回调
 * @returns {Promise<{ rootUrl:string, info:object, dispose:()=>void }>}
 */
export async function parseThreeTzFile(file, onProgress = () => {}) {
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(0)

  /* 1. 读取文件 */
  onProgress(`读取归档文件 (${fileSizeMB} MB)...`, 5)
  const buffer = await file.arrayBuffer()
  await yieldToMain()

  /* 2. 异步解压（fflate 的 unzip 内部使用 Web Worker，不阻塞主线程） */
  onProgress('解压 .3tz 归档...（大文件需要较长时间）', 10)
  let unzipped
  try {
    unzipped = await new Promise((resolve, reject) => {
      unzip(new Uint8Array(buffer), (err, data) => {
        if (err) reject(err)
        else resolve(data)
      })
    })
  } catch (e) {
    throw new Error(`解压 .3tz 失败（文件可能损坏）: ${e.message}`)
  }
  await yieldToMain()

  /* 3. 构建条目索引 */
  onProgress('构建文件索引...', 30)
  const entries = new Map()   // normalizedPath → Uint8Array
  let tilesetPath = null

  for (const [rawPath, data] of Object.entries(unzipped)) {
    const path = normalizePath(rawPath)
    // 跳过目录条目
    if (data.length === 0 && (path.endsWith('/') || rawPath.endsWith('/'))) continue
    entries.set(path, data)

    // 找到最浅层的 tileset.json
    const basename = path.split('/').pop().toLowerCase()
    if (basename === 'tileset.json') {
      if (!tilesetPath || path.split('/').length < tilesetPath.split('/').length) {
        tilesetPath = path
      }
    }
  }

  // 释放对原始解压结果的引用，减少峰值内存
  unzipped = null

  if (!tilesetPath) {
    throw new Error('.3tz 归档中未找到 tileset.json，请确认文件格式正确')
  }

  console.log(`[3tz] 找到 tileset.json: ${tilesetPath}，共 ${entries.size} 个文件`)

  // 创建一个唯一前缀，防止多个模型同时加载时串台
  const archiveId = generateUUID()
  const virtualBase = `http://3tz-virtual.local/${archiveId}/`

  /* 4. 为所有条目分批创建 Blob URL，并注册到全局虚拟路由 */
  const blobUrls = new Map() // 用于后续清理
  const BATCH_SIZE = 100
  let processed = 0
  const total = entries.size

  const disposeBlobMappings = () => {
    for (const path of blobUrls.keys()) {
      window.__3tzVirtualPaths.delete(virtualBase + path)
    }
    for (const url of blobUrls.values()) {
      URL.revokeObjectURL(url)
    }
    blobUrls.clear()
  }

  const failUnsupportedTile = (path, detail) => {
    disposeBlobMappings()
    entries.clear()
    throw new Error(
      `3D Tiles 中的瓦片 "${path}" 使用了旧版 ${detail}，当前前端基于 three.js / 3d-tiles-renderer 无法解析。` +
      '请将该模型重新导出或转换为 glTF 2.0 / GLB 2.0 后再加载。',
    )
  }

  let gzipCount = 0
  let legacyB3dmCount = 0
  for (const [path, data] of entries) {
    // 某些工具会在 ZIP 内部对瓦片文件额外 gzip 压缩，需要二次解压
    let finalData = maybeGunzip(data)
    if (finalData !== data) gzipCount++

    // 修复旧版 b3dm 文件头（20/24 字节头 → 标准 28 字节头）
    if (path.toLowerCase().endsWith('.b3dm')) {
      const fixed = fixLegacyB3dm(finalData)
      if (fixed !== finalData) {
        finalData = fixed
        legacyB3dmCount++
      }

      const glbVersion = getB3dmGlbVersion(finalData)
      if (glbVersion != null && glbVersion < 2) {
        failUnsupportedTile(path, `B3DM 内嵌 GLB v${glbVersion}.x`)
      }
    } else if (path.toLowerCase().endsWith('.glb')) {
      const glbVersion = getGlbVersion(finalData)
      if (glbVersion != null && glbVersion < 2) {
        failUnsupportedTile(path, `GLB v${glbVersion}.x`)
      }
    }

    const blob = new Blob([finalData], { type: guessMime(path) })
    const blobUrl = URL.createObjectURL(blob)
    blobUrls.set(path, blobUrl)

    // 映射：http://3tz-virtual.local/uuid/Tile_0/tile.b3dm -> blobUrl
    window.__3tzVirtualPaths.set(virtualBase + path, blobUrl)

    processed++

    if (processed % BATCH_SIZE === 0) {
      const pct = 35 + Math.floor(55 * processed / total)
      onProgress(`加载解压文件到内存... (${processed}/${total})`, pct)
      await yieldToMain()
    }
  }
  if (gzipCount > 0) {
    console.log(`[3tz] 检测到 ${gzipCount} 个 gzip 压缩文件，已自动解压`)
  }
  if (legacyB3dmCount > 0) {
    console.log(`[3tz] 检测到 ${legacyB3dmCount} 个旧版 b3dm 文件头，已自动转换为标准格式`)
  }

  /* 5. 预处理 tileset.json：兼容 3D Tiles 1.1 */
  // 3D Tiles 1.1 使用 contents（复数）替代 content（单数），
  // 但 3d-tiles-renderer 0.3.x 只识别 content，需要转换。
  for (const [path, data] of entries) {
    if (!path.endsWith('.json')) continue
    try {
      const text = new TextDecoder().decode(data)
      const json = JSON.parse(text)
      if (!json.root) continue // 不是 tileset.json 格式

      let modified = false
      const fixContents = (tile) => {
        if (!tile) return
        // contents (数组) → content (取第一个)
        if (!tile.content && tile.contents && Array.isArray(tile.contents) && tile.contents.length > 0) {
          tile.content = tile.contents[0]
          modified = true
        }
        if (tile.children) {
          for (const child of tile.children) fixContents(child)
        }
      }
      fixContents(json.root)

      if (modified) {
        console.log(`[3tz] 已将 ${path} 中的 contents 转换为 content（3D Tiles 1.1 兼容）`)
        const newData = new TextEncoder().encode(JSON.stringify(json))
        const newBlob = new Blob([newData], { type: 'application/json' })
        const oldBlobUrl = blobUrls.get(path)
        if (oldBlobUrl) URL.revokeObjectURL(oldBlobUrl)
        const newBlobUrl = URL.createObjectURL(newBlob)
        blobUrls.set(path, newBlobUrl)
        window.__3tzVirtualPaths.set(virtualBase + path, newBlobUrl)
      }
    } catch {
      // 不是有效 JSON，跳过
    }
  }

  onProgress('场景构建就绪', 95)
  await yieldToMain()

  // 提供给 TilesRenderer 的 rootUrl 变成符合原生 URL 规范的 HTTP 伪地址
  const rootUrl = virtualBase + tilesetPath

  /* 6. 汇总信息 */
  const extCounts = {}
  for (const path of entries.keys()) {
    const dot = path.lastIndexOf('.')
    const ext = dot >= 0 ? path.substring(dot).toLowerCase() : '(无扩展名)'
    extCounts[ext] = (extCounts[ext] || 0) + 1
  }

  const info = {
    tilesetPath,
    entryCount: entries.size,
    totalBytes: buffer.byteLength,
    extensions: extCounts,
  }

  console.log('[3tz] 解析完成:', info)

  return {
    rootUrl,
    info,
    /** 释放所有 Blob URL 与内存 */
    dispose: () => {
      // 1. 删除全局路由并释放 Blob
      disposeBlobMappings()

      // 2. 释放内存
      entries.clear()
      console.log('[3tz] 资源已释放')
    },
  }
}
