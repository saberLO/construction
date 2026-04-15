import * as THREE from 'three'

/** @typedef {{ id?: number, img_name?: string, position: number[], rotation: number[][], fx?: number, fy?: number, width?: number, height?: number }} ColmapCameraPreset */

/**
 * 解析 antimatter15/splat 风格的 cameras.json
 * @param {string} text
 * @returns {ColmapCameraPreset[]}
 */
export function parseCamerasJson(text) {
  const data = JSON.parse(text)
  if (!Array.isArray(data)) throw new Error('cameras.json 应为相机对象数组')
  return data.filter(c => c && Array.isArray(c.position) && Array.isArray(c.rotation))
}

/**
 * 将 COLMAP 导出的预设应用到 GaussianSplats3D.Viewer（OrbitControls）
 * rotation 为世界→相机 3×3 矩阵（与 splat 演示一致）
 * @param {*} viewer - GaussianSplats3D.Viewer
 * @param {ColmapCameraPreset} preset
 */
export function applyColmapPresetToViewer(viewer, preset) {
  const cam = viewer.camera
  const controls = viewer.controls
  if (!cam || !controls || !preset?.position || !preset?.rotation) return

  const pos = new THREE.Vector3().fromArray(preset.position)
  const R = preset.rotation
  if (!Array.isArray(R[0]) || R[0].length < 3) return

  const m3 = new THREE.Matrix3().set(
    R[0][0], R[0][1], R[0][2],
    R[1][0], R[1][1], R[1][2],
    R[2][0], R[2][1], R[2][2],
  )

  const forward = new THREE.Vector3(0, 0, -1).applyMatrix3(m3.clone().transpose())
  if (forward.lengthSq() < 1e-10) return
  forward.normalize()

  const dist = 3
  const target = pos.clone().add(forward.multiplyScalar(dist))

  cam.up.copy(viewer.cameraUp)
  controls.target.copy(target)
  cam.position.copy(pos)
  cam.lookAt(target)
  controls.update()
}
