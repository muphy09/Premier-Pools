import { NavLink, useLocation } from 'react-router-dom';
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from 'react';
import FranchiseLogo from './FranchiseLogo';
import FeedbackLauncher from './FeedbackLauncher';
import { useFranchiseAppName } from '../hooks/useFranchiseAppName';
import './NavigationBar.css';

interface NavigationBarProps {
  userName?: string;
  onLogout?: () => void;
  onProfileSettings?: () => void;
  isAdmin?: boolean;
  isMaster?: boolean;
  franchiseId?: string;
  showWorkflowTab?: boolean;
  workflowUnreadCount?: number;
  onAdminPanelClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  onAdminSettings?: () => void;
  isAdminSettingsOpen?: boolean;
  showFeedback?: boolean;
  onFeedback?: () => void;
  feedbackLauncherRef?: Ref<HTMLButtonElement>;
  actingLabel?: string | null;
  onStopActing?: () => void;
  appVersion?: string;
}

type NavigationIconName = 'dashboard' | 'workflow' | 'settings' | 'adminSettings' | 'master' | 'admin' | 'exit';

function NavigationIcon({ name }: { name: NavigationIconName }) {
  const paths: Record<NavigationIconName, React.ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    workflow: (
      <>
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z" />
        <path d="M4 9h16M15.5 13.5h.01M15.5 17h.01" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.96 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.04 14H3v-4h.04A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.96 4 1.7 1.7 0 0 0 10 2.44V2h4v.44A1.7 1.7 0 0 0 15.04 4a1.7 1.7 0 0 0 1.87-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 20.96 10H21v4h-.04A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
    adminSettings: (
      <>
        <path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h8M16 18h4" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="9" cy="12" r="2" />
        <circle cx="14" cy="18" r="2" />
      </>
    ),
    master: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0M18.5 4.5l.7.7 1.3-1.3" />
      </>
    ),
    admin: (
      <>
        <path d="M12 3 5 6v5c0 4.5 2.9 8.3 7 10 4.1-1.7 7-5.5 7-10V6Z" />
        <path d="m9.2 12 1.8 1.8 3.8-4" />
      </>
    ),
    exit: (
      <>
        <path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5M14 8l4 4-4 4M18 12H8" />
      </>
    ),
  };

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function NavigationBar({
  userName = 'User',
  onLogout,
  onProfileSettings,
  isAdmin = false,
  isMaster = false,
  franchiseId,
  showWorkflowTab = false,
  workflowUnreadCount = 0,
  onAdminPanelClick,
  onAdminSettings,
  isAdminSettingsOpen = false,
  showFeedback = false,
  onFeedback,
  feedbackLauncherRef,
  actingLabel,
  onStopActing,
  appVersion,
}: NavigationBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [navItemTooltip, setNavItemTooltip] = useState<{ label: string; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const { displayName } = useFranchiseAppName(franchiseId);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
    setNavItemTooltip(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [drawerOpen]);

  const linkClassName = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-link active' : 'nav-link';

  const showNavItemTooltip = (
    event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>
  ) => {
    const label = event.currentTarget.dataset.navigationLabel;
    if (!label) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setNavItemTooltip({ label, top: rect.top + rect.height / 2 });
  };

  const hideNavItemTooltip = () => setNavItemTooltip(null);

  return (
    <>
      <button
        className="nav-mobile-toggle"
        type="button"
        aria-label="Open application navigation"
        aria-controls="application-navigation"
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen(true)}
      >
        <span />
        <span />
        <span />
      </button>

      <button
        className={`navigation-scrim${drawerOpen ? ' is-open' : ''}`}
        type="button"
        aria-label="Close application navigation"
        tabIndex={drawerOpen ? 0 : -1}
        onClick={() => setDrawerOpen(false)}
      />

      <nav
        id="application-navigation"
        className={`navigation-bar${drawerOpen ? ' is-open' : ''}`}
        aria-label="Application navigation"
      >
        <div className="nav-brand-block">
          <div className="nav-left">
            <FranchiseLogo className="nav-logo" alt="Franchise Logo" franchiseId={franchiseId} />
            <div className="nav-title-container">
              <div className="nav-brand" title={displayName}>{displayName}</div>
              <div className="nav-title">Proposal Builder</div>
            </div>
          </div>
          <button
            className="nav-mobile-close"
            type="button"
            aria-label="Close application navigation"
            onClick={() => setDrawerOpen(false)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="nav-divider" />
        <div className="nav-welcome" title={userName}>
          <span>Welcome,</span>
          <strong>{userName}</strong>
        </div>
        <div className="nav-divider" />

        <div className="nav-center">
          <div className="nav-links-primary">
            <NavLink
              to="/"
              end
              className={linkClassName}
              data-navigation-label="Dashboard"
              onMouseEnter={showNavItemTooltip}
              onMouseLeave={hideNavItemTooltip}
              onFocus={showNavItemTooltip}
              onBlur={hideNavItemTooltip}
            >
              <NavigationIcon name="dashboard" />
              <span className="nav-link-content">Dashboard</span>
            </NavLink>

            {showWorkflowTab && (
              <NavLink
                to="/workflow"
                className={linkClassName}
                data-navigation-label="Book Keeper"
                onMouseEnter={showNavItemTooltip}
                onMouseLeave={hideNavItemTooltip}
                onFocus={showNavItemTooltip}
                onBlur={hideNavItemTooltip}
              >
                <NavigationIcon name="workflow" />
                <span className="nav-link-content">
                  <span>Book Keeper</span>
                  {workflowUnreadCount > 0 && <span className="nav-unread-pill">{workflowUnreadCount}</span>}
                </span>
              </NavLink>
            )}

            <NavLink
              to="/settings"
              className={linkClassName}
              data-navigation-label="Settings"
              onMouseEnter={showNavItemTooltip}
              onMouseLeave={hideNavItemTooltip}
              onFocus={showNavItemTooltip}
              onBlur={hideNavItemTooltip}
            >
              <NavigationIcon name="settings" />
              <span className="nav-link-content">Settings</span>
            </NavLink>

            {isAdmin && onAdminSettings && (
              <button
                className={`nav-link nav-admin-settings${isAdminSettingsOpen ? ' active' : ''}`}
                type="button"
                data-navigation-label="Franchise Settings"
                onMouseEnter={showNavItemTooltip}
                onMouseLeave={hideNavItemTooltip}
                onFocus={showNavItemTooltip}
                onBlur={hideNavItemTooltip}
                aria-haspopup="dialog"
                aria-expanded={isAdminSettingsOpen}
                onClick={() => {
                  setDrawerOpen(false);
                  onAdminSettings();
                }}
              >
                <NavigationIcon name="adminSettings" />
                <span className="nav-link-content">Franchise Settings</span>
              </button>
            )}

            {isMaster && (
              <NavLink
                to="/master"
                className={linkClassName}
                data-navigation-label="Master"
                onMouseEnter={showNavItemTooltip}
                onMouseLeave={hideNavItemTooltip}
                onFocus={showNavItemTooltip}
                onBlur={hideNavItemTooltip}
              >
                <NavigationIcon name="master" />
                <span className="nav-link-content">Master</span>
              </NavLink>
            )}

            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) => `nav-link nav-link-admin${isActive ? ' active' : ''}`}
                data-navigation-label="Admin Panel"
                onMouseEnter={showNavItemTooltip}
                onMouseLeave={hideNavItemTooltip}
                onFocus={showNavItemTooltip}
                onBlur={hideNavItemTooltip}
                onClick={onAdminPanelClick}
              >
                <NavigationIcon name="admin" />
                <span className="nav-link-content">Admin Panel</span>
              </NavLink>
            )}
          </div>

          {actingLabel && onStopActing && (
            <div className="nav-acting-block">
              <span className="nav-acting-label">Acting for {actingLabel}</span>
              <button
                className="nav-link nav-action-link"
                type="button"
                data-navigation-label="Stop Acting"
                onMouseEnter={showNavItemTooltip}
                onMouseLeave={hideNavItemTooltip}
                onFocus={showNavItemTooltip}
                onBlur={hideNavItemTooltip}
                onClick={onStopActing}
              >
                <NavigationIcon name="exit" />
                <span className="nav-link-content">Stop Acting</span>
              </button>
            </div>
          )}
        </div>

        <div className="nav-footer">
          {appVersion && <div className="nav-version">Version {appVersion}</div>}
          <div className="nav-footer-actions">
            <div className="nav-right" ref={menuRef}>
              <button
                className="nav-avatar"
                type="button"
                aria-label="Profile Settings"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                {userName.charAt(0).toUpperCase()}
              </button>
              <span className="nav-profile-tooltip" aria-hidden="true">Profile Settings</span>

              {menuOpen && (onProfileSettings || onLogout) && (
                <div className="nav-user-menu" role="menu">
                  <div className="nav-user-menu-heading">{userName}</div>
                  {onProfileSettings && (
                    <button
                      className="nav-user-menu-item nav-profile-settings"
                      onClick={() => {
                        setMenuOpen(false);
                        onProfileSettings();
                      }}
                      type="button"
                      role="menuitem"
                    >
                      Profile Settings
                    </button>
                  )}
                  {onProfileSettings && onLogout && <div className="nav-user-menu-divider" />}
                  {onLogout && (
                    <button
                      className="nav-user-menu-item nav-logout"
                      onClick={() => {
                        setMenuOpen(false);
                        onLogout();
                      }}
                      type="button"
                      role="menuitem"
                    >
                      Logout
                    </button>
                  )}
                </div>
              )}
            </div>

            {showFeedback && onFeedback && (
              <FeedbackLauncher
                ref={feedbackLauncherRef}
                className="nav-feedback-button"
                tooltip="Submit feedback"
                onClick={onFeedback}
              />
            )}
          </div>
        </div>
      </nav>
      {navItemTooltip && (
        <span
          className="nav-item-tooltip"
          style={{ top: navItemTooltip.top }}
          aria-hidden="true"
        >
          {navItemTooltip.label}
        </span>
      )}
    </>
  );
}

export default NavigationBar;
