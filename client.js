window.__ModuleLoader__.load({
  id: 'fastgithub-accelerate',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    function FastGithubBadge() {
      const [status, setStatus] = React.useState(null);
      const probe = React.useCallback(async () => {
        try {
          const response = await fetch('/fastgithub/status', { cache: 'no-store' });
          setStatus(await response.json());
        } catch { setStatus(null); }
      }, []);
      React.useEffect(() => {
        probe();
        const timer = setInterval(probe, 30000);
        return () => clearInterval(timer);
      }, [probe]);

      // Status badge only: acceleration itself runs host-side (proxy policy +
      // an active source). The browser never talks to GitHub directly through
      // the proxy — a browser sends origin-form requests, which no forward
      // proxy can serve — so the client only reports state.
      const on = Boolean(status && status.accelerating);
      const source = status ? status.source : 'none';
      // Warn only when the proxy is up but NO acceleration source is active
      // (no FastGithub hijack and no custom proxyUrl configured).
      const warn = Boolean(status && status.policy === 'proxied' && !on);
      const color = on ? '#22c55e' : warn ? '#f59e0b' : '#ef4444';
      let label;
      if (on) {
        label = source === 'custom-proxy'
          ? '🚀 自定义代理加速中'
          : '🚀 FastGithub 加速中';
      } else if (warn) {
        label = '⚠ 无加速源 (未接管 DNS / 未配 proxyUrl)';
      } else if (status && status.policy === 'proxied') {
        label = '· 代理就绪';
      } else {
        label = 'FastGithub 未加速';
      }
      return h('span', {
        title: status
          ? `source ${status.source} · endpoint ${status.endpoint} · policy ${status.policy}` +
            (status.lastError ? ` · ${status.lastError}` : '')
          : 'FastGithub status unreachable',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 999, fontSize: 11, lineHeight: '16px',
          border: `1px solid ${color}55`,
          background: on ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)',
          color,
          cursor: 'default', whiteSpace: 'nowrap',
        },
      }, label);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'fastgithub-status',
          order: 99,
        }, FastGithubBadge));
      },
    };
  },
});