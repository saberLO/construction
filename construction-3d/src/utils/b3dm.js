const B3DM_MAGIC = [0x62, 0x33, 0x64, 0x6d]
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46]
const STANDARD_HEADER_LENGTH = 28

function hasMagic(data, offset, magic) {
  if (offset < 0 || offset + magic.length > data.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (data[offset + i] !== magic[i]) return false
  }
  return true
}

function encodeFeatureTableJson(batchLength) {
  const json = `{"BATCH_LENGTH":${batchLength}}`
  const bytes = new TextEncoder().encode(json)

  // b3dm 头部是 28 字节，补空格让后续 section 起始位置保持 8 字节对齐。
  const padding = (8 - ((STANDARD_HEADER_LENGTH + bytes.length) % 8)) % 8
  const padded = new Uint8Array(bytes.length + padding)
  padded.set(bytes)
  padded.fill(0x20, bytes.length)
  return padded
}

function looksLikeStandardB3dm(data, view) {
  const glbStart = getStandardB3dmGlbOffset(data, view)
  if (glbStart == null) return false
  const byteLength = view.getUint32(8, true)

  return (
    byteLength === data.length &&
    glbStart >= STANDARD_HEADER_LENGTH &&
    hasMagic(data, glbStart, GLB_MAGIC)
  )
}

function getStandardB3dmGlbOffset(data, view = null) {
  if (data.length < STANDARD_HEADER_LENGTH) return null

  const dv = view || new DataView(data.buffer, data.byteOffset, data.byteLength)
  const ftJsonLen = dv.getUint32(12, true)
  const ftBinLen = dv.getUint32(16, true)
  const btJsonLen = dv.getUint32(20, true)
  const btBinLen = dv.getUint32(24, true)
  const glbStart = STANDARD_HEADER_LENGTH + ftJsonLen + ftBinLen + btJsonLen + btBinLen

  if (glbStart + 8 > data.length) return null
  return glbStart
}

function convertLegacyB3dm(data, legacyHeaderLength, batchLength, btJsonLen, btBinLen = 0) {
  const featureTableJsonBytes = encodeFeatureTableJson(batchLength)
  const payload = data.subarray(legacyHeaderLength)
  const newByteLength = STANDARD_HEADER_LENGTH + featureTableJsonBytes.length + payload.length
  const next = new Uint8Array(newByteLength)

  next.set(data.subarray(0, 4), 0)

  const view = new DataView(next.buffer, next.byteOffset, next.byteLength)
  view.setUint32(4, 1, true)
  view.setUint32(8, newByteLength, true)
  view.setUint32(12, featureTableJsonBytes.length, true)
  view.setUint32(16, 0, true)
  view.setUint32(20, btJsonLen, true)
  view.setUint32(24, btBinLen, true)

  next.set(featureTableJsonBytes, STANDARD_HEADER_LENGTH)
  next.set(payload, STANDARD_HEADER_LENGTH + featureTableJsonBytes.length)

  return next
}

export function fixLegacyB3dm(data) {
  if (data.length < 20 || !hasMagic(data, 0, B3DM_MAGIC)) {
    return data
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  if (looksLikeStandardB3dm(data, view)) {
    return data
  }

  const legacyBatchLength20 = view.getUint32(12, true)
  const legacyBatchTableLen20 = view.getUint32(16, true)
  const legacy20GlbStart = 20 + legacyBatchTableLen20

  if (hasMagic(data, legacy20GlbStart, GLB_MAGIC)) {
    return convertLegacyB3dm(data, 20, legacyBatchLength20, legacyBatchTableLen20, 0)
  }

  if (data.length < 24) {
    return data
  }

  const legacyBtJsonLen24 = view.getUint32(12, true)
  const legacyBtBinLen24 = view.getUint32(16, true)
  const legacyBatchLength24 = view.getUint32(20, true)
  const legacy24GlbStart = 24 + legacyBtJsonLen24 + legacyBtBinLen24

  if (hasMagic(data, legacy24GlbStart, GLB_MAGIC)) {
    return convertLegacyB3dm(
      data,
      24,
      legacyBatchLength24,
      legacyBtJsonLen24,
      legacyBtBinLen24,
    )
  }

  return data
}

export function getGlbVersion(data, offset = 0) {
  if (!hasMagic(data, offset, GLB_MAGIC) || offset + 8 > data.length) {
    return null
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return view.getUint32(offset + 4, true)
}

export function getB3dmGlbVersion(data) {
  const fixed = fixLegacyB3dm(data)
  if (!hasMagic(fixed, 0, B3DM_MAGIC)) {
    return null
  }

  const view = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength)
  const glbStart = getStandardB3dmGlbOffset(fixed, view)
  if (glbStart == null) {
    return null
  }

  return getGlbVersion(fixed, glbStart)
}
