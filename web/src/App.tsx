import { Routes, Route } from 'react-router-dom'
import MapPage from './pages/MapPage.js'
import PlacePage from './pages/PlacePage.js'
import ListsPage from './pages/ListsPage.js'
import ProfilePage from './pages/ProfilePage.js'
import AuthPage from './pages/AuthPage.js'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MapPage />} />
      <Route path="/places/:id" element={<PlacePage />} />
      <Route path="/lists" element={<ListsPage />} />
      <Route path="/lists/:slug" element={<ListsPage />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/auth" element={<AuthPage />} />
    </Routes>
  )
}
