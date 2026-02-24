'use strict';

const { WebSocketServer } = require('ws');
const { URL } = require('url');
const events = require('./events');
const { resolveAuthIdentity } = require('../middleware/auth');

function makeDummyResponse() {
  const headers = new Map();
  return {
    getHeader: (name) => headers.get(String(name).toLowerCase()),
    setHeader: (name, value) => headers.set(String(name).toLowerCase(), value),
    removeHeader: (name) => headers.delete(String(name).toLowerCase()),
  };
}

function attachRealtimeWebSocket({ server, sessionMiddleware, allowedOrigins, path = '/ws' }) {
  if (!server) return null;

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const origin = req.headers.origin;
      if (Array.isArray(allowedOrigins) && allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const requestUrl = new URL(req.url, 'http://localhost');
      if (requestUrl.pathname !== path) return;

      const authToken = String(requestUrl.searchParams.get('auth') || '').trim();
      if (authToken && !req.headers.authorization) {
        req.headers.authorization = `Bearer ${authToken}`;
      }

      const res = makeDummyResponse();
      sessionMiddleware(req, res, () => {
        const identity = resolveAuthIdentity(req);
        if (!identity) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        req.userId = identity.userId;
        req.userType = identity.userType;
        req.userName = identity.userName;

        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      });
    } catch (_) {
      try {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      } catch (_) {}
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'ready', data: { ts: Date.now() } }));

    const onMessage = (payload) => {
      try {
        ws.send(JSON.stringify({ type: 'message', data: payload || {} }));
      } catch (_) {}
    };
    const onTicket = (payload) => {
      try {
        ws.send(JSON.stringify({ type: 'ticket', data: payload || {} }));
      } catch (_) {}
    };

    events.on('message', onMessage);
    events.on('ticket', onTicket);

    ws.on('close', () => {
      events.off('message', onMessage);
      events.off('ticket', onTicket);
    });
  });

  return wss;
}

module.exports = {
  attachRealtimeWebSocket,
};
