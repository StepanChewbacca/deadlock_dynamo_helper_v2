import { Controller, Get, Header } from '@nestjs/common';

@Controller('deadlock/live')
export class DebugPageController {
  @Get('debug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getDebugPage(): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Deadlock Live Debug Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
      :root {
        --bg-main: #0b0b0e;
        --bg-card: #14141a;
        --bg-hover: #1e1e26;
        --border: #23232f;
        --text-primary: #f3f4f6;
        --text-secondary: #9ca3af;
        --accent: #ff6b4a; /* Deadlock themed orange/rust */
        --accent-glow: rgba(255, 107, 74, 0.15);
        --success: #10b981;
        --danger: #ef4444;
        --team-amber: #f59e0b;
        --team-sapphire: #3b82f6;
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: 'Outfit', sans-serif;
        background-color: var(--bg-main);
        color: var(--text-primary);
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        overflow-x: hidden;
      }

      header {
        background-color: var(--bg-card);
        border-bottom: 1px solid var(--border);
        padding: 1.25rem 2rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: sticky;
        top: 0;
        z-index: 10;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      .logo-container {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .logo-icon {
        width: 10px;
        height: 24px;
        background-color: var(--accent);
        border-radius: 2px;
        box-shadow: 0 0 10px var(--accent);
        animation: pulse 2s infinite ease-in-out;
      }

      @keyframes pulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }

      h1 {
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: -0.025em;
        text-transform: uppercase;
        background: linear-gradient(135deg, var(--text-primary) 30%, var(--accent) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .badge {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        padding: 0.25rem 0.75rem;
        border-radius: 9999px;
        display: flex;
        align-items: center;
        gap: 0.375rem;
        border: 1px solid currentColor;
      }

      .badge-live {
        color: var(--success);
        background-color: rgba(16, 185, 129, 0.1);
      }

      .badge-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: currentColor;
        animation: blink 1.5s infinite;
      }

      @keyframes blink {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 1; }
      }

      main {
        flex: 1;
        padding: 2rem;
        max-width: 1600px;
        width: 100%;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 1fr 400px;
        gap: 2rem;
      }

      @media (max-width: 1200px) {
        main {
          grid-template-columns: 1fr;
        }
      }

      .section-title {
        font-size: 1.125rem;
        font-weight: 600;
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--text-primary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .section-title::after {
        content: '';
        flex: 1;
        height: 1px;
        background-color: var(--border);
      }

      .card {
        background-color: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
        transition: transform 0.2s ease, border-color 0.2s ease;
      }

      .card:hover {
        border-color: rgba(255, 107, 74, 0.3);
      }

      .match-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--border);
        padding-bottom: 1rem;
        margin-bottom: 1.5rem;
      }

      .match-info-meta {
        display: flex;
        gap: 1.5rem;
      }

      .meta-item {
        display: flex;
        flex-direction: column;
      }

      .meta-label {
        font-size: 0.75rem;
        color: var(--text-secondary);
        text-transform: uppercase;
        margin-bottom: 0.25rem;
      }

      .meta-value {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text-primary);
      }

      .match-clock-container {
        font-family: 'JetBrains Mono', monospace;
        font-size: 2rem;
        font-weight: 700;
        color: var(--accent);
        text-shadow: 0 0 10px var(--accent-glow);
        background-color: rgba(0, 0, 0, 0.2);
        padding: 0.25rem 1rem;
        border-radius: 8px;
        border: 1px solid var(--border);
      }

      .table-wrapper {
        overflow-x: auto;
        border-radius: 8px;
        border: 1px solid var(--border);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
        font-size: 0.875rem;
      }

      th {
        background-color: rgba(0, 0, 0, 0.2);
        color: var(--text-secondary);
        font-weight: 500;
        padding: 0.75rem 1rem;
        text-transform: uppercase;
        font-size: 0.75rem;
        letter-spacing: 0.05em;
        border-bottom: 1px solid var(--border);
      }

      td {
        padding: 1rem;
        border-bottom: 1px solid var(--border);
        vertical-align: middle;
      }

      tr:last-child td {
        border-bottom: none;
      }

      tr:hover td {
        background-color: rgba(255, 255, 255, 0.01);
      }

      .player-name-cell {
        display: flex;
        flex-direction: column;
      }

      .player-steam {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.75rem;
        color: var(--text-secondary);
        margin-top: 0.125rem;
      }

      .hero-badge {
        display: inline-block;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        background-color: var(--bg-main);
        border: 1px solid var(--border);
        font-weight: 500;
      }

      .team-badge {
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.125rem 0.375rem;
        border-radius: 4px;
        text-transform: uppercase;
      }

      .team-1 {
        background-color: rgba(59, 130, 246, 0.15);
        color: var(--team-sapphire);
      }

      .team-2 {
        background-color: rgba(245, 158, 11, 0.15);
        color: var(--team-amber);
      }

      .items-container {
        display: flex;
        flex-wrap: wrap;
        gap: 0.375rem;
      }

      .item-tag {
        font-size: 0.75rem;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        background-color: #1b1b22;
        border: 1px solid var(--border);
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }

      .item-tag.enhanced {
        border-color: #fbbf24;
        background: linear-gradient(135deg, #201a0d 0%, #15151a 100%);
        color: #f59e0b;
        box-shadow: 0 0 5px rgba(245, 158, 11, 0.1);
      }

      .item-time {
        font-size: 0.65rem;
        color: var(--text-secondary);
        font-family: 'JetBrains Mono', monospace;
      }

      .recent-events-panel {
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 120px);
        position: sticky;
        top: 6.5rem;
      }

      .events-list {
        flex: 1;
        overflow-y: auto;
        border: 1px solid var(--border);
        border-radius: 8px;
        background-color: rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
      }

      .event-item {
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--border);
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.75rem;
        transition: background-color 0.15s ease;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .event-item:hover {
        background-color: rgba(255, 255, 255, 0.02);
      }

      .event-header {
        display: flex;
        justify-content: space-between;
        color: var(--text-secondary);
      }

      .event-source {
        color: var(--accent);
        font-weight: 500;
      }

      .event-meta {
        display: flex;
        gap: 0.5rem;
        margin: 0.125rem 0;
      }

      .event-key {
        color: #60a5fa;
        font-weight: 500;
      }

      .event-payload {
        color: #34d399;
        word-break: break-all;
        background-color: rgba(0, 0, 0, 0.3);
        padding: 0.375rem;
        border-radius: 4px;
        margin-top: 0.25rem;
        white-space: pre-wrap;
      }

      .empty-state {
        padding: 3rem;
        text-align: center;
        color: var(--text-secondary);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
      }

      .empty-state-icon {
        font-size: 2rem;
        color: var(--border);
      }

      /* Scrollbar Styling */
      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: var(--border);
        border-radius: 3px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: var(--text-secondary);
      }
    </style>
  </head>
  <body>
    <header>
      <div class="logo-container">
        <div class="logo-icon"></div>
        <h1>Deadlock Live Ingest</h1>
      </div>
      <div class="badge badge-live">
        <div class="badge-dot"></div>
        Polling Active
      </div>
    </header>

    <main>
      <section>
        <div class="section-title">Match States</div>
        <div id="matches-container">
          <div class="card empty-state">
            <div class="empty-state-icon">📡</div>
            <div>Waiting for live telemetry events...</div>
            <div style="font-size: 0.85rem">Start the Overwolf client and launch a Deadlock match.</div>
          </div>
        </div>
      </section>

      <section class="recent-events-panel">
        <div class="section-title">Raw Event Log (Recent 100)</div>
        <div class="events-list" id="events-container">
          <div class="empty-state" style="padding: 2rem 1rem">
            <div>No events captured yet.</div>
          </div>
        </div>
      </section>
    </main>

    <script>
      function formatTime(seconds) {
        if (seconds === undefined || seconds === null) return '--:--';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const pad = (n) => String(n).padStart(2, '0');
        if (h > 0) {
          return `\${pad(h)}:\${pad(m)}:\${pad(s)}`;
        }
        return `\${pad(m)}:\${pad(s)}`;
      }

      async function refresh() {
        try {
          const states = await fetch('/deadlock/live/states').then((res) => res.json());
          const events = await fetch('/deadlock/live/events/recent').then((res) => res.json());

          renderStates(states);
          renderEvents(events);
        } catch (err) {
          console.error('Failed to poll live data:', err);
        }
      }

      function renderStates(states) {
        const container = document.getElementById('matches-container');
        if (!states || states.length === 0) {
          container.innerHTML = `
            <div class="card empty-state">
              <div class="empty-state-icon">📡</div>
              <div>Waiting for live telemetry events...</div>
              <div style="font-size: 0.85rem">Start the Overwolf client and launch a Deadlock match.</div>
            </div>`;
          return;
        }

        container.innerHTML = states.map(match => {
          const players = Object.values(match.playersBySteamId || {});
          
          let playersHtml = '';
          if (players.length === 0) {
            playersHtml = `<tr><td colspan="7" class="empty-state" style="padding: 1.5rem">No players registered in roster yet.</td></tr>`;
          } else {
            playersHtml = players.map(p => {
              const itemsHtml = (p.items || []).map(item => \`
                <span class="item-tag \${item.enhanced ? 'enhanced' : ''}">
                  \${item.name}
                  \${item.firstSeenAtSec !== undefined ? \`<span class="item-time">(\${formatTime(item.firstSeenAtSec)})</span>\` : ''}
                </span>
              \`).join('');

              const kda = \`\${p.kills ?? 0} / \${p.deaths ?? 0} / \${p.assists ?? 0}\`;
              const teamClass = p.teamId === 1 ? 'team-1' : p.teamId === 2 ? 'team-2' : '';
              const teamName = p.teamId === 1 ? 'Sapphire' : p.teamId === 2 ? 'Amber' : p.teamId ?? 'Unknown';

              return \`
                <tr>
                  <td>
                    <div class="player-name-cell">
                      <strong>\${p.playerName || 'Player'}</strong>
                      <span class="player-steam">\${p.steamId}</span>
                    </div>
                  </td>
                  <td>
                    <span class="hero-badge">\${p.heroName || p.heroId || 'unassigned'}</span>
                  </td>
                  <td>
                    <span class="team-badge \${teamClass}">\${teamName}</span>
                  </td>
                  <td style="font-family: 'JetBrains Mono', monospace;">\${p.souls !== undefined ? p.souls.toLocaleString() : '--'}</td>
                  <td>\${p.health !== undefined ? \`\${p.health} / \${p.maxHealth || p.health}\` : '--'}</td>
                  <td style="font-family: 'JetBrains Mono', monospace;">\${kda}</td>
                  <td>
                    <div class="items-container">\${itemsHtml || '<span style="color: var(--text-secondary); font-style: italic;">No items</span>'}</div>
                  </td>
                </tr>
              \`;
            }).join('');
          }

          return `
            <div class="card">
              <div class="match-header">
                <div class="match-info-meta">
                  <div class="meta-item">
                    <span class="meta-label">Match ID</span>
                    <span class="meta-value" style="font-family: 'JetBrains Mono', monospace; color: var(--text-primary)">${match.matchId}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">Last Updated</span>
                    <span class="meta-value" style="font-size: 0.875rem; font-weight: normal; margin-top: 0.25rem">${new Date(match.lastUpdatedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
                <div class="match-clock-container">
                  ${formatTime(match.gameTimeSec)}
                </div>
              </div>
              <div class="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Hero</th>
                      <th>Team</th>
                      <th>Souls</th>
                      <th>Health</th>
                      <th>KDA</th>
                      <th>Items</th>
                    </tr>
                  </thead>
                  <tbody>
                    \${playersHtml}
                  </tbody>
                </table>
              </div>
            </div>`;
        }).join('');
      }

      function renderEvents(events) {
        const container = document.getElementById('events-container');
        if (!events || events.length === 0) {
          container.innerHTML = `
            <div class="empty-state" style="padding: 2rem 1rem">
              <div>No events captured yet.</div>
            </div>`;
          return;
        }

        container.innerHTML = events.slice().reverse().map(e => {
          let payloadStr = '';
          try {
            payloadStr = typeof e.payload === 'object' ? JSON.stringify(e.payload, null, 2) : String(e.payload);
          } catch {
            payloadStr = String(e.payload);
          }

          return `
            <div class="event-item">
              <div class="event-header">
                <span class="event-source">${e.source}</span>
                <span>${new Date(e.receivedAt).toLocaleTimeString()}</span>
              </div>
              <div class="event-meta">
                ${e.feature ? `<span>feature: <strong style="color: #cbd5e1">${e.feature}</strong></span>` : ''}
                ${e.category ? `<span>category: <strong style="color: #cbd5e1">${e.category}</strong></span>` : ''}
                ${e.key ? `<span>key: <strong class="event-key">${e.key}</strong></span>` : ''}
                ${e.matchId ? `<span>match: <strong style="color: #cbd5e1">${e.matchId}</strong></span>` : ''}
              </div>
              <pre class="event-payload">${payloadStr}</pre>
            </div>`;
        }).join('');
      }

      setInterval(refresh, 1000);
      refresh();
    </script>
  </body>
</html>`;
  }
}
