import { useRef, useState } from 'react'
import { OnlineApp } from './online/OnlineApp'
import { EventsScreen } from './ui/EventsScreen'
import { LocalGameScreen } from './ui/LocalGameScreen'

type BaseView = 'online' | 'local'
type View = BaseView | 'events'

function viewFromParams(): View {
  const params = new URLSearchParams(window.location.search)
  if (params.get('events') === '1') {
    return 'events'
  }
  return params.get('local') === '1' ? 'local' : 'online'
}

function writeViewParam(view: View) {
  const url = new URL(window.location.href)
  url.searchParams.delete('local')
  url.searchParams.delete('events')
  if (view === 'local') {
    url.searchParams.set('local', '1')
  }
  if (view === 'events') {
    url.searchParams.set('events', '1')
  }
  window.history.replaceState({}, '', url)
}

export default function App() {
  const initial = viewFromParams()
  const [view, setView] = useState<View>(initial)
  // The screen to return to from the catalogue; a direct ?events=1 link
  // falls back to the online lobby.
  const baseRef = useRef<BaseView>(initial === 'local' ? 'local' : 'online')
  const base: BaseView = view === 'events' ? baseRef.current : view

  function showBase(next: BaseView) {
    baseRef.current = next
    writeViewParam(next)
    setView(next)
  }

  function showEvents() {
    writeViewParam('events')
    setView('events')
  }

  return (
    <>
      {base === 'online' && (
        <div hidden={view === 'events'}>
          <OnlineApp
            onPlayLocal={() => showBase('local')}
            onShowEvents={showEvents}
          />
        </div>
      )}
      {base === 'local' && (
        <div hidden={view === 'events'}>
          <LocalGameScreen
            onPlayOnline={() => showBase('online')}
            onShowEvents={showEvents}
          />
        </div>
      )}
      {view === 'events' && (
        <EventsScreen onBack={() => showBase(baseRef.current)} />
      )}
    </>
  )
}
