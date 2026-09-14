import { Routes, Route } from 'react-router-dom'
import AppLayout from './components/AppLayout.js'
import PlaceSheet from './components/PlaceSheet.js'
import MapPage from './pages/MapPage.js'
import ListsPage from './pages/ListsPage.js'
import ProfilePage from './pages/ProfilePage.js'
import AuthPage from './pages/AuthPage.js'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* /places/:id nests under the map so MapPage stays mounted and the detail
            renders as a sheet on top of it. Deep links still work: landing on
            /places/:id renders the map first, then the sheet over it. */}
        <Route path="/" element={<MapPage />}>
          <Route path="places/:id" element={<PlaceSheet />} />
        </Route>
        <Route path="/lists" element={<ListsPage />} />
        <Route path="/lists/:slug" element={<ListsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      {/* Sign-in sits outside the shell: no tab bar while you're being authenticated. */}
      <Route path="/auth" element={<AuthPage />} />
    </Routes>
  )
}
