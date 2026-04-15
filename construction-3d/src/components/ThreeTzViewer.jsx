/**
 * ThreeTzViewer.jsx — .3tz (3D Tiles Archive) 可视化查看器
 *
 * 自包含 React 组件，接收一个 .3tz File 对象，
 * 内部完成解压、场景初始化、瓦片调度渲染、自动相机对齐。
 *
 * 依赖：three (项目已有)、3d-tiles-renderer、fflate
 */

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TilesRenderer } from '3d-tiles-renderer'
import { ImplicitTilingPlugin, GLTFExtensionsPlugin } from '3d-tiles-renderer/plugins'
import { parseThreeTzFile } from '../utils/threeTzArchive'

/**
 * @param {object}   props
 * @param {File}     props.file        .3tz 文件
 * @param {function} props.onLoaded    加载完成回调 (info)
 * @param {function} props.onError     错误回调 (message)
 * @param {function} props.onProgress  进度回调 (message, percent)
 * @param {React.Ref} ref              暴露 resetCamera()
 */
const ThreeTzViewer = forwardRef(function ThreeTzViewer(
  { file, onLoaded, onError, onProgress },
  ref,
) {
  const containerRef = useRef(null)

  // 所有可变的运行时状态收拢在一个 ref 中，避免闭包陈旧
  const stateRef = useRef({
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    tiles: null,
    archive: null,
    raf: null,
    resizeObserver: null,
    mounted: true,
    fitted: false,
    settled: false,
  })

  /* ── 暴露给父组件的方法 ──────────────────────────────────── */
  useImperativeHandle(ref, () => ({
    resetCamera: () => {
      const { controls, camera, tiles } = stateRef.current
      if (!controls || !camera || !tiles) return
      try {
        const sphere = new THREE.Sphere()
        tiles.getBoundingSphere(sphere)
        if (sphere.radius > 0 && isFinite(sphere.radius)) {
          const r = sphere.radius
          camera.position.set(
            sphere.center.x + r * 1.2,
            sphere.center.y + r * 0.8,
            sphere.center.z + r * 1.2,
          )
          controls.target.copy(sphere.center)
          camera.near = Math.max(0.01, r * 0.001)
          camera.far = r * 100
          camera.updateProjectionMatrix()
          controls.update()
        }
      } catch (e) {
        console.warn('[ThreeTzViewer] resetCamera:', e)
      }
    },
  }))

  /* ── 清理函数 ────────────────────────────────────────────── */
  const cleanup = useCallback(() => {
    const s = stateRef.current
    if (s.raf) {
      cancelAnimationFrame(s.raf)
      s.raf = null
    }
    s.resizeObserver?.disconnect()
    s.resizeObserver = null

    try { s.tiles?.dispose() } catch (_) { /* noop */ }
    try { s.controls?.dispose() } catch (_) { /* noop */ }

    const canvas = s.renderer?.domElement
    if (canvas?.parentNode) canvas.parentNode.removeChild(canvas)
    try { s.renderer?.dispose() } catch (_) { /* noop */ }

    s.archive?.dispose()

    Object.assign(s, {
      renderer: null, scene: null, camera: null, controls: null,
      tiles: null, archive: null, fitted: false, settled: false,
    })
  }, [])

  /* ── 组件挂载 / 卸载 ────────────────────────────────────── */
  useEffect(() => {
    stateRef.current.mounted = true
    return () => {
      stateRef.current.mounted = false
      cleanup()
    }
  }, [cleanup])

  /* ── file 变化时重新加载 ────────────────────────────────── */
  useEffect(() => {
    if (!file) return
    loadAndRender(file)
    return () => cleanup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  /* ── 核心加载逻辑 ───────────────────────────────────────── */
  async function loadAndRender(f) {
    cleanup()
    const s = stateRef.current

    try {
      /* 1. 解压 .3tz */
      const result = await parseThreeTzFile(f, (msg, pct) => {
        if (s.mounted) onProgress?.(msg, pct)
      })

      if (!s.mounted || !containerRef.current) {
        result.dispose()
        return
      }
      s.archive = result

      onProgress?.('初始化 3D 场景...', 85)

      /* 2. 初始化 Three.js */
      const container = containerRef.current
      const w = container.clientWidth || 800
      const h = container.clientHeight || 600

      // 场景
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x050810)
      s.scene = scene

      // 相机
      const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100000)
      camera.position.set(0, 100, 200)
      s.camera = camera

      // 渲染器
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setSize(w, h)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      container.appendChild(renderer.domElement)
      s.renderer = renderer

      // 控制器
      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.1
      controls.screenSpacePanning = true
      s.controls = controls

      // 光照
      const ambient = new THREE.AmbientLight(0xffffff, 1.0)
      scene.add(ambient)
      const directional = new THREE.DirectionalLight(0xffffff, 0.8)
      directional.position.set(100, 200, 100)
      scene.add(directional)
      const hemi = new THREE.HemisphereLight(0xb1e1ff, 0xb97a20, 0.5)
      scene.add(hemi)

      /* 3. TilesRenderer */
      const tiles = new TilesRenderer(result.rootUrl)
      tiles.registerPlugin(new ImplicitTilingPlugin())
      tiles.registerPlugin(new GLTFExtensionsPlugin({ rtc: true }))
      tiles.setCamera(camera)
      tiles.setResolutionFromRenderer(camera, renderer)
      scene.add(tiles.group)
      s.tiles = tiles

      const finishLoaded = (info) => {
        if (s.settled || !s.mounted) return
        s.settled = true
        s.fitted = true
        onLoaded?.(info)
      }

      const failLoading = (message) => {
        if (s.settled || !s.mounted) return
        s.settled = true
        onError?.(message)
      }

      /* 辅助：根据包围球定位相机 */
      const fitCameraToSphere = (sphere) => {
        if (!sphere || sphere.radius <= 0 || !isFinite(sphere.radius)) return false
        const r = sphere.radius
        const c = sphere.center
        camera.position.set(c.x + r * 1.2, c.y + r * 0.8, c.z + r * 1.2)
        controls.target.copy(c)
        camera.near = Math.max(0.01, r * 0.001)
        camera.far = r * 100
        camera.updateProjectionMatrix()
        controls.update()
        return true
      }

      /* 监听 tileset 加载事件，第一时间定位相机 */
      tiles.addEventListener('load-tile-set', () => {
        if (s.settled) return
        try {
          const sphere = new THREE.Sphere()
          if (tiles.getBoundingSphere(sphere) && fitCameraToSphere(sphere)) {
            console.log('[ThreeTzViewer] 根据 tileset 包围球定位相机:', sphere.center, '半径:', sphere.radius)
            finishLoaded({
              ...result.info,
              boundingRadius: sphere.radius,
              center: { x: sphere.center.x, y: sphere.center.y, z: sphere.center.z },
            })
          }
        } catch (e) {
          console.warn('[ThreeTzViewer] 定位相机失败:', e)
        }
      })

      /* 监听瓦片加载开始/完成 */
      tiles.addEventListener('tiles-load-start', () => {
        console.log('[ThreeTzViewer] 开始加载瓦片内容...')
      })
      tiles.addEventListener('tiles-load-end', () => {
        console.log('[ThreeTzViewer] 瓦片内容加载完成')
      })

      /* 4. 尺寸监听 */
      const onResize = () => {
        if (!s.mounted || !container) return
        const nw = container.clientWidth
        const nh = container.clientHeight
        if (nw <= 0 || nh <= 0) return
        camera.aspect = nw / nh
        camera.updateProjectionMatrix()
        renderer.setSize(nw, nh)
        tiles.setResolutionFromRenderer(camera, renderer)
      }
      s.resizeObserver = new ResizeObserver(onResize)
      s.resizeObserver.observe(container)

      /* 5. 渲染循环 */
      let frameCount = 0
      function animate() {
        if (!s.mounted) return
        s.raf = requestAnimationFrame(animate)

        try {
          controls.update()
          camera.updateMatrixWorld()
          tiles.update()
          renderer.render(scene, camera)
        } catch (e) {
          // 避免渲染错误导致帧计数停滞
          console.warn('[ThreeTzViewer] 渲染帧错误:', e)
        }

        frameCount++

        if (
          !s.settled &&
          !s.fitted &&
          tiles.stats.failed > 0 &&
          tiles.stats.downloading === 0 &&
          tiles.stats.parsing === 0
        ) {
          failLoading(
            `3D Tiles 加载失败：已有 ${tiles.stats.failed} 个瓦片解析失败。` +
            '如果控制台里出现 "Legacy binary file detected"，说明瓦片内嵌的是 glTF 1.0，当前前端无法渲染。',
          )
          return
        }

        // 备用：如果 load-tile-set 事件没有触发相机定位，在这里重试
        if (!s.settled && !s.fitted && frameCount > 30 && frameCount % 10 === 0) {
          try {
            const sphere = new THREE.Sphere()
            if (tiles.getBoundingSphere(sphere) && fitCameraToSphere(sphere)) {
              finishLoaded({
                ...result.info,
                boundingRadius: sphere.radius,
                center: { x: sphere.center.x, y: sphere.center.y, z: sphere.center.z },
              })
            }
          } catch {
            // 继续重试
          }
        }

        // 若 120 帧后仍未 fit，视为加载完成（可能是空场景或极小场景）
        if (!s.settled && !s.fitted && frameCount > 120) {
          if (tiles.stats.failed > 0) {
            failLoading(`3D Tiles 加载失败：共有 ${tiles.stats.failed} 个瓦片未能解析，请检查控制台中的首个报错。`)
          } else {
            console.warn('[ThreeTzViewer] 120帧后仍未获取包围球，强制完成加载')
            finishLoaded(result.info)
          }
        }
      }
      animate()

      onProgress?.('加载瓦片中...', 95)

    } catch (e) {
      console.error('[ThreeTzViewer] 加载失败:', e)
      if (s.mounted) onError?.(e.message || '加载 .3tz 文件失败')
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    />
  )
})

export default ThreeTzViewer
