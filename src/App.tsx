import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import Auth from './components/Auth'
import Dashboard from './components/Dashboard'
import { supabase } from './lib/supabase'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const handleLogout = () => {
    supabase.auth.signOut()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F3ED] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-stone-400 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F4F3ED]">
      {session ? <Dashboard onLogout={handleLogout} /> : <Auth />}
    </div>
  )
}

export default App
