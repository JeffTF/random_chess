import { useState } from 'react'
import { OnlineApp } from './online/OnlineApp'
import { LocalGameScreen } from './ui/LocalGameScreen'

type Mode = 'online' | 'local'

function initialMode(): Mode {
  const params = new URLSearchParams(window.location.search)
  return params.get('local') === '1' ? 'local' : 'online'
}

export default function App() {
  const [mode, setMode] = useState<Mode>(initialMode)

  if (mode === 'local') {
    return <LocalGameScreen onPlayOnline={() => setMode('online')} />
  }

  return <OnlineApp onPlayLocal={() => setMode('local')} />
}
