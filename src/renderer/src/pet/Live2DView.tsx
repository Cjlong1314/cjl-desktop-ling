import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import * as PIXI from 'pixi.js'
import { install } from '@pixi/unsafe-eval'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import type { CharacterMood } from '../../../shared/types'
import type { Live2DHandle } from './live2d-types'

install(PIXI)
window.PIXI = PIXI
Live2DModel.registerTicker(PIXI.Ticker)

const MODEL_URL = './live2d/Mao/Mao.model3.json'

interface Props {
  onHitChange?: (hit: boolean) => void
  onClick?: () => void
  onContextMenu?: (event: React.MouseEvent) => void
}

const Live2DView = forwardRef<Live2DHandle, Props>(function Live2DView(
  { onHitChange, onClick, onContextMenu },
  ref
) {
  const [failed, setFailed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<Live2DModel | null>(null)
  const talkingRef = useRef(false)
  const clickRef = useRef(onClick)
  const hitRef = useRef(onHitChange)
  clickRef.current = onClick
  hitRef.current = onHitChange

  useImperativeHandle(ref, () => ({
    setMood(mood: CharacterMood) {
      const model = modelRef.current
      talkingRef.current = mood === 'talk'
      if (!model) return
      if (mood === 'talk' || mood === 'listen') {
        void model.motion('TapBody')
      } else {
        void model.motion('Idle')
      }
    }
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    let disposed = false
    const app = new PIXI.Application({
      view: canvas,
      backgroundAlpha: 0,
      antialias: true,
      autoStart: true,
      width: wrap.clientWidth,
      height: wrap.clientHeight,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    })

    const resize = (): void => {
      const width = wrap.clientWidth
      const height = wrap.clientHeight
      if (width < 10 || height < 10) return
      app.renderer.resize(width, height)
      const model = modelRef.current
      if (!model) return
      fitModel(model, width, height)
    }

    const onTick = (): void => {
      const model = modelRef.current
      if (!model || !talkingRef.current) return
      const core = (model as unknown as { internalModel?: { coreModel?: { setParameterValueById?: (id: string, v: number) => void } } }).internalModel?.coreModel
      core?.setParameterValueById?.('ParamA', 0.3 + Math.random() * 0.7)
    }

    app.ticker.add(onTick)
    window.addEventListener('resize', resize)
    const observer = new ResizeObserver(() => resize())
    observer.observe(wrap)

    void (async () => {
      try {
        const model = await Live2DModel.from(MODEL_URL, { autoInteract: false })
        if (disposed) {
          model.destroy()
          return
        }
        modelRef.current = model
        app.stage.addChild(model)
        fitModel(model, wrap.clientWidth, wrap.clientHeight)
        void model.motion('Idle')
        model.on('hit', () => clickRef.current?.())
      } catch (error) {
        console.error('Live2D load failed', error)
        if (!disposed) setFailed(true)
      }
    })()

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('resize', resize)
      app.ticker.remove(onTick)
      modelRef.current = null
      app.destroy(true, { children: true })
    }
  }, [])

  return (
    <div
      ref={wrapRef}
      className="live2d-wrap"
      data-hit="character"
      onMouseEnter={() => hitRef.current?.(true)}
      onMouseLeave={() => hitRef.current?.(false)}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} className="live2d-canvas" />
      {failed ? <div className="live2d-fallback">灵</div> : null}
    </div>
  )
})

function fitModel(model: Live2DModel, width: number, height: number): void {
  if (!model.width || !model.height || width < 10 || height < 10) return
  const scale = Math.min(width / model.width, height / model.height) * 0.82
  model.anchor.set(0.5, 1)
  model.scale.set(scale)
  model.x = width / 2
  model.y = height - 8
}

export default Live2DView
