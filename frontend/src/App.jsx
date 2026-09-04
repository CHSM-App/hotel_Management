import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/auth/Login';
import OwnerDashboard from './pages/lodge/OwnerDashboard';
import UserGuide from './pages/lodge/UserGuide';
import AdminLogin from './pages/internal/AdminLogin';
import LodgesDashboard from './pages/internal/LodgesDashboard';
import LodgeRegistration from './pages/internal/LodgeRegistration';
import LodgeDetail from './pages/internal/LodgeDetail';
import LodgePublicPage from './pages/public/LodgePublicPage';
import OrderPage from './pages/public/OrderPage';
import NotFound from './pages/NotFound';
import RequireStaff from './components/RequireStaff';
import RequireLodgeAuth from './components/RequireLodgeAuth';
import RedirectIfAuthed from './components/RedirectIfAuthed';
import { ToastProvider } from './components/Toast';

function App() {
  // ToastProvider sits outside the router, so a toast raised by an action that
  // navigates away survives the navigation and is still read where it lands.
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />

          {/* Public, unauthenticated — a lodge's customer-facing room/rate page. */}
          <Route path="/lodge/:slug" element={<LodgePublicPage />} />

          {/* Public, unauthenticated — what the food QR codes point at. One link
              per property for room service (the guest gives their room number and
              the PIN from check-in), and one per dining table. The table route is
              /order/t/:token rather than nesting under a slug because the token
              already identifies the property, and a shorter URL makes a denser,
              more scannable QR. */}
          <Route path="/order/t/:token" element={<OrderPage mode="table" />} />
          <Route path="/order/:slug" element={<OrderPage mode="lodge" />} />

          {/* Lodge owner / reception / kitchen sign-in. Wrapped so Back from the
              dashboard cannot land on a sign-in form the user has already
              satisfied — it bounces straight back to /dashboard. */}
          <Route
            path="/login"
            element={
              <RedirectIfAuthed to="/dashboard">
                <Login />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/dashboard"
            element={
              <RequireLodgeAuth>
                <OwnerDashboard />
              </RequireLodgeAuth>
            }
          />

          {/* Behind the same gate as the dashboard: the guide names this
              property and is filtered to the reader's own permissions, so it is
              not public help text. */}
          <Route
            path="/guide"
            element={
              <RequireLodgeAuth>
                <UserGuide />
              </RequireLodgeAuth>
            }
          />

          {/* Staff-only, all unlisted below. Not linked from any nav — reached by direct URL. */}
          <Route
            path="/vtadmin"
            element={
              <RedirectIfAuthed to="/vt-internal/dashboard" when="staff">
                <AdminLogin />
              </RedirectIfAuthed>
            }
          />
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
          {/* Ranked below /lodges/new by the router regardless of order here —
              a static segment always beats a dynamic one. */}
          <Route
            path="/vt-internal/lodges/:id"
            element={
              <RequireStaff>
                <LodgeDetail />
              </RequireStaff>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
