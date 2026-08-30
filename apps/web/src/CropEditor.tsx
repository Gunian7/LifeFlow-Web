import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

interface Frame { x: number; y: number; w: number }
type Corner = 'nw' | 'ne' | 'sw' | 'se'
type DragMode = 'move' | Corner

const MIN_FRAME_WIDTH = 48

function clampFrame(frame: Frame, dw: number, dh: number, aspect: number): Frame {
  const maxW = Math.min(dw, dh * aspect)
  const w = Math.min(Math.max(frame.w, MIN_FRAME_WIDTH), maxW)
  return {
    x: Math.min(Math.max(frame.x, 0), Math.max(0, dw - w)),
    y: Math.min(Math.max(frame.y, 0), Math.max(0, dh - w / aspect)),
    w,
  }
}

interface CropEditorProps {
  dataUrl: string
  aspect: number
  onApply: (dataUrl: string) => void
  onCancel: () => void
}

export function CropEditor({ dataUrl, aspect, onApply, onCancel }: CropEditorProps) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [error, setError] = useState('')
  const frameRef = useRef<Frame | null>(null)
  frameRef.current = frame

  const dragRef = useRef<null | { mode: DragMode; corner: Corner; anchorX: number; anchorY: number; pointerX: number; pointerY: number; start: Frame }>(null)
  const viewRef = useRef<{ dw: number; dh: number; offsetX: number; offsetY: number; scale: number } | null>(null)

  useEffect(() => {
    const image = new Image()
    image.onload = () => setNatural({ w: image.naturalWidth, h: image.naturalHeight })
    image.src = dataUrl
  }, [dataUrl])

  useEffect(() => {
    const measure = () => {
      const el = boxRef.current
      if (el) setBox({ w: el.clientWidth, h: el.clientHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const view = useMemo(() => {
    if (!natural || !box || box.w === 0 || box.h === 0) return null
    const scale = Math.min(box.w / natural.w, box.h / natural.h)
    const dw = natural.w * scale
    const dh = natural.h * scale
    return { scale, dw, dh, offsetX: (box.w - dw) / 2, offsetY: (box.h - dh) / 2 }
  }, [natural, box])
  viewRef.current = view

  useEffect(() => {
    if (!view) return
    setFrame((current) => {
      const maxW = Math.min(view.dw, view.dh * aspect)
      const baseW = current?.w ?? maxW
      const w = Math.min(Math.max(baseW, MIN_FRAME_WIDTH), maxW)
      return clampFrame({ x: current?.x ?? (view.dw - w) / 2, y: current?.y ?? (view.dh - w / aspect) / 2, w }, view.dw, view.dh, aspect)
    })
  }, [view, aspect])

  const dragHandlers = useRef<{ move: (event: PointerEvent) => void; up: () => void } | null>(null)
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      const v = viewRef.current
      if (!drag || !v) return
      const dx = event.clientX - drag.pointerX
      const dy = event.clientY - drag.pointerY
      if (drag.mode === 'move') {
        setFrame(clampFrame({ x: drag.start.x + dx, y: drag.start.y + dy, w: drag.start.w }, v.dw, v.dh, aspect))
        return
      }
      const px = Math.min(Math.max(drag.pointerX + dx - v.offsetX, 0), v.dw)
      const py = Math.min(Math.max(drag.pointerY + dy - v.offsetY, 0), v.dh)
      const w = Math.max(Math.abs(px - drag.anchorX), Math.abs(py - drag.anchorY) * aspect)
      const x = px >= drag.anchorX ? drag.anchorX : drag.anchorX - w
      const y = py >= drag.anchorY ? drag.anchorY : drag.anchorY - w / aspect
      setFrame(clampFrame({ x, y, w }, v.dw, v.dh, aspect))
    }
    const up = () => { dragRef.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    dragHandlers.current = { move, up }
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [aspect])

  function beginDrag(mode: DragMode, event: ReactPointerEvent<HTMLElement>) {
    const current = frameRef.current
    if (!current || !view) return
    event.preventDefault()
    event.stopPropagation()
    const height = current.w / aspect
    const corner: Corner = mode === 'move' ? 'se' : mode
    const anchorX = corner === 'nw' || corner === 'sw' ? current.x + current.w : current.x
    const anchorY = corner === 'nw' || corner === 'ne' ? current.y + height : current.y
    dragRef.current = { mode, corner, anchorX, anchorY, pointerX: event.clientX, pointerY: event.clientY, start: { ...current } }
    if (dragHandlers.current) {
      window.addEventListener('pointermove', dragHandlers.current.move)
      window.addEventListener('pointerup', dragHandlers.current.up)
    }
  }

  const maxFrameW = view ? Math.min(view.dw, view.dh * aspect) : 0
  const zoomValue = frame && maxFrameW > 0 ? Math.round((frame.w / maxFrameW) * 100) : 100

  function setZoom(pct: number) {
    const current = frameRef.current
    if (!current || !view || maxFrameW <= 0) return
    const w = (pct / 100) * maxFrameW
    const height = w / aspect
    setFrame(clampFrame({ x: current.x + current.w / 2 - w / 2, y: current.y + current.w / aspect / 2 - height / 2, w }, view.dw, view.dh, aspect))
  }

  function apply() {
    const current = frameRef.current
    const v = viewRef.current
    if (!current || !v || !natural) return
    const image = new Image()
    image.onload = () => {
      const sx = Math.max(0, Math.round(current.x / v.scale))
      const sy = Math.max(0, Math.round(current.y / v.scale))
      const sw = Math.max(1, Math.min(Math.round(current.w / v.scale), natural.w - sx))
      const sh = Math.max(1, Math.min(Math.round(current.w / v.scale / aspect), natural.h - sy))
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      const context = canvas.getContext('2d')
      if (!context) { setError('裁剪失败，请重试。'); return }
      context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)
      const sizeLimit = Math.round(2.5 * 1024 * 1024)
      const isPng = dataUrl.startsWith('data:image/png')
      let output = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85)
      if (output.length > sizeLimit && isPng) output = canvas.toDataURL('image/jpeg', 0.85)
      if (output.length > sizeLimit) { setError('裁剪结果太大，把裁剪框缩小一点再试。'); return }
      onApply(output)
    }
    image.src = dataUrl
  }

  return (
    <div className="crop-editor">
      <div className="crop-box" ref={boxRef}>
        {view && <div className="crop-stage" style={{ left: view.offsetX, top: view.offsetY, width: view.dw, height: view.dh }}>
          <img src={dataUrl} alt="" draggable={false} />
          {frame && <div className="crop-frame" style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.w / aspect }} onPointerDown={(event) => beginDrag('move', event)}>
            <span className="crop-handle nw" onPointerDown={(event) => beginDrag('nw', event)} />
            <span className="crop-handle ne" onPointerDown={(event) => beginDrag('ne', event)} />
            <span className="crop-handle sw" onPointerDown={(event) => beginDrag('sw', event)} />
            <span className="crop-handle se" onPointerDown={(event) => beginDrag('se', event)} />
          </div>}
        </div>}
      </div>
      <div className="bg-controls">
        <label>缩放<input type="range" min={20} max={100} value={Math.min(100, Math.max(20, zoomValue))} onChange={(event) => setZoom(Number(event.target.value))} /><span>{Math.min(100, Math.max(20, zoomValue))}%</span></label>
      </div>
      {error && <p className="error-text">{error}</p>}
      <p className="settings-copy">拖动裁剪框选画面，拖四个角调整大小，裁剪框按屏幕比例锁定，框里就是背景实际显示的范围。</p>
      <div className="settings-actions">
        <button className="secondary-button" type="button" onClick={apply}>应用裁剪</button>
        <button className="link-button" type="button" onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}
