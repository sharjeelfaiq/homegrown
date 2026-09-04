import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAudioActivity } from '../AudioActivityContext'
import { useGenerationActivity } from '../GenerationActivityContext'
import { usePageVisible } from '../hooks/usePageVisible'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { audioEngine } from '../audio/AudioEngine'
import { ORB_FRAGMENT, ORB_VERTEX } from './orbShader'

function Orb() {
  const meshRef = useRef<THREE.Mesh>(null)
  const { activeAudio } = useAudioActivity()
  const { anyRunning } = useGenerationActivity()

  // Refs so useFrame reads fresh values without re-subscribing the loop.
  const activeRef = useRef(activeAudio)
  activeRef.current = activeAudio
  const runningRef = useRef(anyRunning)
  runningRef.current = anyRunning

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uColor: { value: new THREE.Color('#3B82F6') },
      uDeep: { value: new THREE.Color('#0D1535') },
    }),
    [],
  )

  useFrame((_, delta) => {
    const t = (uniforms.uTime.value += delta)
    const el = activeRef.current
    let target = 0
    if (el && !el.paused) {
      target = audioEngine.getLevel()
    } else if (runningRef.current) {
      // No real signal exists while a clip is being generated -- mock a
      // slow beating pulse so the orb reads as "working".
      target = 0.22 + 0.12 * Math.sin(t * 1.7) * Math.sin(t * 0.53)
    }
    uniforms.uLevel.value += (target - uniforms.uLevel.value) * 0.07
    if (meshRef.current) meshRef.current.rotation.y += delta * 0.02
  })

  return (
    <mesh ref={meshRef} position={[1.4, 0.4, 0]}>
      <icosahedronGeometry args={[1.7, 5]} />
      <shaderMaterial
        vertexShader={ORB_VERTEX}
        fragmentShader={ORB_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

/** With frameloop="never" nothing paints until invalidate() -- render one
 * static frame so reduced-motion users get a frozen sculpture, not a void. */
function StaticFrame({ frozen }: { frozen: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (frozen) invalidate()
  }, [frozen, invalidate])
  return null
}

export default function AmbientCanvas() {
  const pageVisible = usePageVisible()
  const reducedMotion = usePrefersReducedMotion()
  const frozen = !pageVisible || reducedMotion

  return (
    <div className="ambient-bg" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        frameloop={frozen ? 'never' : 'always'}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        camera={{ position: [0, 0, 5], fov: 40 }}
      >
        <StaticFrame frozen={frozen} />
        <Orb />
      </Canvas>
      <div className="ambient-vignette" />
    </div>
  )
}
