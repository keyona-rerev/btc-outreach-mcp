import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import fetch from 'node-fetch';

const GAS_URL = process.env.GAS_WEB_APP_URL;
const app = express();
app.use(express.json());

const server = new McpServer({
  name: 'btc-outreach-mcp',
  version: '1.0.0',
});

server.tool(
  'create_draft',
  'Create a Gmail draft from kmeeks@blacktechcapital.com',
  {
    to: z.string().describe('Recipient email address'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body text'),
  },
  async ({ to, subject, body }) => {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
    });
    const result = await response.json();
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  }
);

const transports = {};

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('Unknown session');
  }
});

app.get('/mcp', async (req, res) => {
  res.json({ name: 'btc-outreach-mcp', version: '1.0.0', status: 'ok' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`BTC Outreach MCP running on port ${PORT}`));