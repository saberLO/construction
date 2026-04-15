/**
 * 将相对资源路径转为当前页面下的绝对 URL（供 fetch / 查看器加载）
 */
export function toAbsoluteUrl(pathOrUrl) {
  if (!pathOrUrl) return ''
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  try {
    return new URL(pathOrUrl, window.location.origin).href
  } catch {
    return pathOrUrl
  }
}
