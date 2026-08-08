import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/auth/Login';
import OwnerDashboard from './pages/lodge/OwnerDashboard';
import AdminLogin from './pages/internal/AdminLogin';
import LodgesDashboard from './pages/internal/LodgesDashboard';
import LodgeRegistration from './pages/internal/LodgeRegistration';
import LodgePublicPage from './pages/public/LodgePublicPage';
import NotFound from './pages/NotFound';
import RequireStaff from './components/RequireStaff';
import RequireLodgeAuth from './components/RequireLodgeAuth';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />

        {/* Public, unauthenticated — a lodge's customer-facing room/rate page. */}
        <Route path="/lodge/:slug" element={<LodgePublicPage />} />

        {/* Lodge owner / reception / kitchen sign-in. */}
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <RequireLodgeAuth>
              <OwnerDashboard />
            </RequireLodgeAuth>
          }
        />

        {/* Staff-only, all unlisted below. Not linked from any nav — reached by direct URL. */}
        <Route path="/vtadmin" element={<AdminLogin />} />
        <Route
          path="/vt-internal/dashboard"
          element={
            <RequireStaff>
              <LodgesDashboard />
            </RequireStaff>
          }
        />
        <Route
          path="/vt-internal/lodges/new"
          element={
            <RequireStaff>
              <LodgeRegistration />
            </RequireStaff>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
