import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Credentials from './pages/Credentials';
import Dashboard from './pages/Dashboard';
import ProjectView from './pages/ProjectView';

export default function App() {
  return (
    <div className="layout">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects/:id" element={<ProjectView />} />
          <Route path="/credentials" element={<Credentials />} />
        </Routes>
      </main>
    </div>
  );
}
