/**
 * 检测 .3tz 文件内容是否有效（流式读取，支持大文件）
 * 用法: node --max-old-space-size=4096 scripts/check-3tz.mjs <path-to-file.3tz>
 */

import { createReadStream, statSync } from 'fs'
import { gunzipSync } from 'fflate'
import { Readable } from 'stream'

const filePath = process.argv[2]
if (!filePath) {
  console.error('用法: node --max-old-space-size=4096 scripts/check-3tz.mjs <path-to-file.3tz>')
  process.exit(1)
}

const stat = statSync(filePath)
console.log(`\n检查文件: ${filePath}`)
console.log(`文件大小: ${(stat.size / 1024 / 1024).toFixed(1)} MB\n`)

// 用 JSZip 流式解析（比 fflate 的 unzipSync 内存友好）
// 但我们这里改用按需解压：只读 ZIP 的中央目录来列出文件，然后抽样几个检查

// === 方案：用 Node.js 原生读取 ZIP 中央目录 ===

const fd = await import('fs').then(fs => fs.promises.open(filePath, 'r'))
const fileSize = stat.size

// ZIP 的 End of Central Directory 在文件末尾（最多 65557 字节）
const eocdSearchSize = Math.min(65557, fileSize)
const eocdBuf = Buffer.alloc(eocdSearchSize)
await fd.read(eocdBuf, 0, eocdSearchSize, fileSize - eocdSearchSize)

// 找 EOCD 签名 0x06054b50
let eocdOffset = -1
for (let i = eocdBuf.length - 22; i >= 0; i--) {
  if (eocdBuf[i] === 0x50 && eocdBuf[i+1] === 0x4b && eocdBuf[i+2] === 0x05 && eocdBuf[i+3] === 0x06) {
    eocdOffset = i
    break
  }
}

if (eocdOffset === -1) {
  console.error('✗ 不是有效的 ZIP 文件（未找到 EOCD）')
  await fd.close()
  process.exit(1)
}

const totalEntries = eocdBuf.readUInt16LE(eocdOffset + 10)
const cdSize = eocdBuf.readUInt32LE(eocdOffset + 12)
const cdOffset = eocdBuf.readUInt32LE(eocdOffset + 16)

console.log(`✓ 有效 ZIP 文件，共 ${totalEntries} 个条目\n`)

// 读取中央目录
const cdBuf = Buffer.alloc(cdSize)
await fd.read(cdBuf, 0, cdSize, cdOffset)

// 解析中央目录条目
const entries = [] // { name, compressedSize, uncompressedSize, localHeaderOffset, method }
let pos = 0
while (pos < cdSize) {
  const sig = cdBuf.readUInt32LE(pos)
  if (sig !== 0x02014b50) break

  const method = cdBuf.readUInt16LE(pos + 10)
  const compSize = cdBuf.readUInt32LE(pos + 20)
  const uncompSize = cdBuf.readUInt32LE(pos + 24)
  const nameLen = cdBuf.readUInt16LE(pos + 28)
  const extraLen = cdBuf.readUInt16LE(pos + 30)
  const commentLen = cdBuf.readUInt16LE(pos + 32)
  const localOffset = cdBuf.readUInt32LE(pos + 42)
  const name = cdBuf.toString('utf8', pos + 46, pos + 46 + nameLen)

  entries.push({ name, compressedSize: compSize, uncompressedSize: uncompSize, localHeaderOffset: localOffset, method })
  pos += 46 + nameLen + extraLen + commentLen
}

// 统计文件类型
const extCounts = {}
for (const e of entries) {
  if (e.name.endsWith('/')) continue // 目录
  const dot = e.name.lastIndexOf('.')
  const ext = dot >= 0 ? e.name.substring(dot).toLowerCase() : '(无扩展名)'
  extCounts[ext] = (extCounts[ext] || 0) + 1
}
console.log('文件类型统计:')
for (const [ext, count] of Object.entries(extCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${ext}: ${count}`)
}
console.log()

// 辅助：从 ZIP 中读取单个文件的内容
async function readEntry(entry) {
  // 读取 local file header 来获取实际数据偏移
  const lhBuf = Buffer.alloc(30)
  await fd.read(lhBuf, 0, 30, entry.localHeaderOffset)
  const lhNameLen = lhBuf.readUInt16LE(26)
  const lhExtraLen = lhBuf.readUInt16LE(28)
  const dataOffset = entry.localHeaderOffset + 30 + lhNameLen + lhExtraLen

  const dataBuf = Buffer.alloc(entry.compressedSize)
  await fd.read(dataBuf, 0, entry.compressedSize, dataOffset)

  if (entry.method === 0) {
    // Stored (no compression)
    return new Uint8Array(dataBuf.buffer, dataBuf.byteOffset, dataBuf.byteLength)
  } else if (entry.method === 8) {
    // Deflate — use fflate
    const { inflateSync } = await import('fflate')
    return inflateSync(new Uint8Array(dataBuf.buffer, dataBuf.byteOffset, dataBuf.byteLength), { size: entry.uncompressedSize })
  } else {
    throw new Error(`不支持的压缩方法: ${entry.method}`)
  }
}

// 检查 tileset.json
const tilesetEntries = entries.filter(e => e.name.toLowerCase().endsWith('tileset.json'))
if (tilesetEntries.length === 0) {
  console.error('✗ 未找到 tileset.json')
} else {
  for (const te of tilesetEntries) {
    console.log(`--- tileset.json: ${te.name} ---`)
    try {
      let data = await readEntry(te)

      // 检查 gzip
      if (data[0] === 0x1f && data[1] === 0x8b) {
        console.log('  ⚠ tileset.json 被 gzip 二次压缩')
        data = gunzipSync(data)
      }

      const json = JSON.parse(new TextDecoder().decode(data))
      console.log(`  版本: ${json.asset?.version || '未知'}`)
      console.log(`  生成工具: ${json.asset?.generator || '未知'}`)
      console.log(`  根瓦片 refine: ${json.root?.refine || '未知'}`)
      console.log(`  geometricError: ${json.geometricError}`)

      const root = json.root
      if (root?.content) {
        console.log(`  根瓦片 content.uri: ${root.content.uri}`)
      } else if (root?.contents) {
        console.log(`  根瓦片使用 contents (3D Tiles 1.1):`, root.contents.map(c => c.uri))
      } else if (root?.implicitTiling) {
        console.log(`  根瓦片使用 implicitTiling:`, root.implicitTiling.subdivisionScheme)
      } else {
        console.log(`  根瓦片无 content/contents（可能只有 children）`)
      }

      const bv = root?.boundingVolume
      if (bv) {
        if (bv.region) console.log(`  boundingVolume: region`, bv.region.map(v => v.toFixed(6)))
        else if (bv.box) console.log(`  boundingVolume: box`)
        else if (bv.sphere) console.log(`  boundingVolume: sphere`)
      }

      // 统计子瓦片
      let contentCount = 0, contentsCount = 0, noContentCount = 0
      const walk = (tile) => {
        if (!tile) return
        if (tile.content) contentCount++
        else if (tile.contents) contentsCount++
        else noContentCount++
        if (tile.children) tile.children.forEach(walk)
      }
      walk(root)
      console.log(`  瓦片统计: content=${contentCount}, contents(1.1)=${contentsCount}, 无内容=${noContentCount}`)
    } catch (e) {
      console.error(`  ✗ 解析失败: ${e.message}`)
    }
    console.log()
  }
}

// 抽样检查瓦片文件
const MAGIC_MAP = {
  'b3dm': 'Batched 3D Model',
  'i3dm': 'Instanced 3D Model',
  'pnts': 'Point Cloud',
  'cmpt': 'Composite',
}

const tileExts = ['.b3dm', '.i3dm', '.pnts', '.cmpt', '.glb', '.gltf']
const tileFiles = entries.filter(e => {
  const dot = e.name.lastIndexOf('.')
  return dot >= 0 && tileExts.includes(e.name.substring(dot).toLowerCase())
})

console.log(`--- 抽样检查瓦片文件 (共 ${tileFiles.length} 个) ---\n`)

const sampleSize = Math.min(5, tileFiles.length)
for (let i = 0; i < sampleSize; i++) {
  const entry = tileFiles[i]
  console.log(`  ${entry.name} (压缩: ${(entry.compressedSize / 1024).toFixed(1)} KB, 原始: ${(entry.uncompressedSize / 1024).toFixed(1)} KB)`)

  try {
    let data = await readEntry(entry)
    const isGz = data[0] === 0x1f && data[1] === 0x8b

    if (isGz) {
      console.log(`    ⚠ gzip 二次压缩! 解压...`)
      data = gunzipSync(data)
      console.log(`    解压后: ${(data.length / 1024).toFixed(1)} KB`)
    }

    const magic4 = String.fromCharCode(data[0], data[1], data[2], data[3])
    const hex4 = Array.from(data.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ')

    if (MAGIC_MAP[magic4]) {
      console.log(`    ✓ 魔术字节: "${magic4}" → ${MAGIC_MAP[magic4]}`)
    } else if (data[0] === 0x67 && data[1] === 0x6c && data[2] === 0x54 && data[3] === 0x46) {
      console.log(`    ✓ 魔术字节: "glTF" → glTF Binary`)
    } else {
      console.log(`    ? 魔术字节: [${hex4}] "${magic4.replace(/[^\x20-\x7e]/g, '?')}" — 未知格式`)
    }

    // b3dm 详细检查
    if (magic4 === 'b3dm') {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const version = view.getUint32(4, true)
      const byteLength = view.getUint32(8, true)
      const ftJsonLen = view.getUint32(12, true)
      const ftBinLen = view.getUint32(16, true)
      const btJsonLen = view.getUint32(20, true)
      const btBinLen = view.getUint32(24, true)
      console.log(`    b3dm v${version}, 声明: ${byteLength}B, 实际: ${data.length}B`)
      console.log(`    featureTable: JSON=${ftJsonLen}B, Bin=${ftBinLen}B`)
      console.log(`    batchTable:   JSON=${btJsonLen}B, Bin=${btBinLen}B`)

      if (byteLength !== data.length) {
        console.log(`    ⚠ 声明大小(${byteLength})与实际(${data.length})不符!`)
      }

      if (ftJsonLen > 0) {
        try {
          const ftJson = new TextDecoder().decode(data.slice(28, 28 + ftJsonLen))
          JSON.parse(ftJson)
          console.log(`    ✓ featureTable JSON 解析成功`)
        } catch (e) {
          console.log(`    ✗ featureTable JSON 解析失败: ${e.message}`)
          const preview = Array.from(data.slice(28, 28 + Math.min(32, ftJsonLen)))
            .map(b => b.toString(16).padStart(2, '0')).join(' ')
          console.log(`    前32字节: [${preview}]`)
        }
      }
    }
  } catch (e) {
    console.log(`    ✗ 读取失败: ${e.message}`)
  }
  console.log()
}

await fd.close()
console.log('检查完成。')
