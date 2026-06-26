import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import AppShell from './components/AppShell';

function Gate() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#888' }}>
        불러오는 중…
      </div>
    );
  }
  return session ? <AppShell /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
