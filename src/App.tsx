import { RouterProvider, Toast, VerticalNavigation } from '@capra/core';
import { Book, Cog, HistoryOutlined, HomeOutlined, Lightbulb, SupportOutlined } from '@capra/icons';
import { Navigate, Route, Routes, useHref, useLocation, useNavigate, type NavigateOptions } from 'react-router-dom';
import { AuditPage } from './pages/Audit';
import { ChatPage } from './pages/Chat';
import { DocsPage } from './pages/Docs';
import { EscalationsPage } from './pages/Escalations';
import { MemoryPage } from './pages/Memory';
import { SettingsPage } from './pages/Settings';

declare module '@capra/core' {
  interface RouterConfig {
    routerOptions: NavigateOptions;
  }
}

function App() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const home = pathname === '/' || pathname.startsWith('/c/');

  return (
    <RouterProvider navigate={navigate} useHref={useHref}>
      <Toast.Provider />
      <div className="app">
        <div className="app-nav">
          <VerticalNavigation aria-label="Vizzy" FORCE__className="app-nav-fill">
            <VerticalNavigation.ItemList>
              <VerticalNavigation.Item label="Home" icon={<HomeOutlined />} href="/" isActive={home} />
              <VerticalNavigation.Item label="Memory" icon={<Lightbulb />} href="/memory" isActive={pathname === '/memory'} />
              <VerticalNavigation.Item label="Escalations" icon={<SupportOutlined />} href="/escalations" isActive={pathname === '/escalations'} />
              <VerticalNavigation.Item label="Audit log" icon={<HistoryOutlined />} href="/audit" isActive={pathname === '/audit'} />
            </VerticalNavigation.ItemList>
            <VerticalNavigation.Footer>
              <VerticalNavigation.Item label="Settings" icon={<Cog />} href="/settings" isActive={pathname === '/settings'} />
              <VerticalNavigation.Item label="Documentation" icon={<Book />} href="/docs" isActive={pathname === '/docs'} />
            </VerticalNavigation.Footer>
          </VerticalNavigation>
        </div>
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/c/:id" element={<ChatPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/escalations" element={<EscalationsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </RouterProvider>
  );
}

export default App;
