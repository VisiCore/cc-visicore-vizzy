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

type NavItemProps = { label: string; icon: React.ReactNode; to: string; active: boolean };

/**
 * A navigation item that changes page inside the app. Capra's item renders a plain link, and a plain
 * link to "/memory" makes the browser load that address in the app's frame: outside the path the app
 * is mounted at, which is a blank page once the app is installed. So the click is handed to the
 * router; the href stays (with the mount path) for opening in a new tab.
 */
function NavItem({ label, icon, to, active }: NavItemProps) {
  const navigate = useNavigate();
  const href = useHref(to);
  return (
    <VerticalNavigation.Item
      label={label}
      icon={icon}
      href={href}
      isActive={active}
      onClick={(event: React.MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
    />
  );
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
              <NavItem label="Home" icon={<HomeOutlined />} to="/" active={home} />
              <NavItem label="Memory" icon={<Lightbulb />} to="/memory" active={pathname === '/memory'} />
              <NavItem label="Escalations" icon={<SupportOutlined />} to="/escalations" active={pathname === '/escalations'} />
              <NavItem label="Audit log" icon={<HistoryOutlined />} to="/audit" active={pathname === '/audit'} />
            </VerticalNavigation.ItemList>
            <VerticalNavigation.Footer>
              <NavItem label="Settings" icon={<Cog />} to="/settings" active={pathname === '/settings'} />
              <NavItem label="Documentation" icon={<Book />} to="/docs" active={pathname === '/docs'} />
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
