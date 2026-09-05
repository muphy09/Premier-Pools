import { useEffect, useRef, useState } from 'react';
import { getSupabaseReachability, isSupabaseEnabled } from '../services/supabaseClient';
import type { CloudConnectionIssue } from '../components/CloudConnectionNotice';

// Poll after completion so slow requests cannot overlap or publish stale results.
export default function useCloudConnection(onReconnect: () => Promise<void>) {
  const [cloudIssue, setCloudIssue] = useState<CloudConnectionIssue>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const retryRef = useRef<() => void>(() => {});
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    if (!isSupabaseEnabled()) return;
    let cancelled = false;
    let checking = false;
    let cloudWasUnavailable = false;
    let networkRevision = 0;
    let timer: number | undefined;

    const updateCloudStatus = async () => {
      if (cancelled || checking) return;
      window.clearTimeout(timer);
      checking = true;
      setCheckingConnection(true);
      const revision = networkRevision;
      let issue: CloudConnectionIssue = null;
      try {
        const reachability = await getSupabaseReachability(true);
        if (cancelled || revision !== networkRevision) return;
        if (!reachability.reachable && reachability.reason !== 'disabled') {
          issue = reachability.reason;
        }
        setCloudIssue(issue);
        if (issue) {
          cloudWasUnavailable = true;
        } else if (cloudWasUnavailable) {
          cloudWasUnavailable = false;
          // Sync must not hold the connection controls or polling open.
          void onReconnectRef.current().catch((error) => {
            console.warn('Unable to sync after reconnecting:', error);
          });
        }
      } catch (error) {
        if (cancelled || revision !== networkRevision) return;
        issue = navigator.onLine === false ? 'no-internet' : 'server-issue';
        cloudWasUnavailable = true;
        setCloudIssue(issue);
        console.warn('Unable to check the cloud connection:', error);
      } finally {
        checking = false;
        if (!cancelled) {
          setCheckingConnection(false);
          timer = window.setTimeout(
            () => void updateCloudStatus(),
            revision !== networkRevision ? 0 : issue ? 5000 : 15000
          );
        }
      }
    };

    const handleNetworkChange = () => {
      networkRevision += 1;
      if (navigator.onLine === false) {
        cloudWasUnavailable = true;
        setCloudIssue('no-internet');
      }
      void updateCloudStatus();
    };
    const handleFocus = () => {
      if (document.visibilityState !== 'hidden') void updateCloudStatus();
    };
    retryRef.current = () => void updateCloudStatus();
    void updateCloudStatus();
    window.addEventListener('offline', handleNetworkChange);
    window.addEventListener('online', handleNetworkChange);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      cancelled = true;
      retryRef.current = () => {};
      window.clearTimeout(timer);
      window.removeEventListener('offline', handleNetworkChange);
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, []);

  return { cloudIssue, checkingConnection, retryConnection: () => retryRef.current() };
}
