import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';

export function EbayConnectCard() {
  const { workspaceId } = useAuth();

  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');


  async function loadStatus() {
    setStatusLoading(true);
    setStatusMsg('');
    setConnected(null);

    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error || !session?.access_token) {
        setStatusMsg('Not logged in. Please sign in again.');
        setConnected(false);
        return;
      }

      if (!workspaceId) {
        setStatusMsg('Workspace not ready yet. Try again in a moment.');
        setConnected(false);
        return;
      }

      const res = await fetch('/api/ebay-oauth-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatusMsg(data?.error || 'Failed to check eBay connection status.');
        setConnected(false);
        return;
      }

      const isConnected = !!data.connected;
      setConnected(isConnected);

      if (!isConnected && data?.reason === 'missing_refresh_token') {
        setStatusMsg('Expired — please reconnect');
      }
    } finally {
      setStatusLoading(false);
    }
  }


  async function connect() {
    setLoading(true);
    setStatusMsg('');

    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error || !session?.access_token) {
        setStatusMsg('Not logged in. Please sign in again.');
        return;
      }

      if (!workspaceId) {
        setStatusMsg('Workspace not ready yet. Try again in a moment.');
        return;
      }

      const res = await fetch('/api/ebay-oauth-start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          return_to: `${window.location.origin}/settings?ebay=connected`,
        }),
      });

      let data: any = {}
      try {
        data = await res.json()
      } catch {
        data = {}
      }
      const oauthUrl = data?.oauthUrl || data?.url

      if (!res.ok || !oauthUrl) {
        setStatusMsg(data?.error || 'Failed to start eBay OAuth.')
        return
      }

      // Redirect user to eBay consent screen
      window.location.assign(String(oauthUrl))
    } finally {
      setLoading(false);
    }
  }


  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>eBay Connection</h3>

      <div style={{ marginBottom: 12, color: '#555' }}>
        Status: {connected === null ? 'Checking…' : connected ? 'Connected' : 'Disconnected'}
      </div>


      {statusMsg ? <div style={{ marginBottom: 12, color: '#b45309' }}>{statusMsg}</div> : null}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={connect}
          disabled={loading || statusLoading}
          style={{
            padding: '10px 16px',
            borderRadius: 6,
            border: 'none',
            background: loading || statusLoading ? '#999' : '#0064d2',
            color: '#fff',
            cursor: loading || statusLoading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Redirecting…' : 'Reconnect eBay'}
        </button>


        <button
          onClick={loadStatus}
          disabled={loading || statusLoading}
          style={{
            padding: '10px 16px',
            borderRadius: 6,
            border: '1px solid #ddd',
            background: '#fff',
            cursor: loading || statusLoading ? 'default' : 'pointer',
          }}
        >
          Refresh
        </button>

      </div>
    </div>
  );
}
