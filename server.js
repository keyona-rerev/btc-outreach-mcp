import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import fetch from 'node-fetch';

const GAS_URL = process.env.GAS_WEB_APP_URL;
const app = express();
app.use(express.json());

app.all('/mcp', async (req, res) => {
  const server = new McpServer({
    name: 'btc-outreach-mcp',
    version: '1.2.0',
  });

  server.tool(
    'create_draft',
    'Create a Gmail draft from kmeeks@blacktechcapital.com',
    {
      to: z.string().describe('Recipient email address. Accepts a comma-separated list for multiple recipients.'),
      subject: z.string().describe('Email subject line'),
      body: z.string().describe('Email body. Plain text, or HTML. HTML passed here is detected automatically and rendered as a rich-text email.'),
      htmlBody: z.string().optional().describe('Optional explicit HTML body. When set, body is used as the plain-text fallback.'),
      cc: z.string().optional().describe('Optional CC recipients. Comma-separated for multiple.'),
      bcc: z.string().optional().describe('Optional BCC recipients. Comma-separated for multiple. Use this for blind announcement sends.'),
      replyTo: z.string().optional().describe('Optional reply-to address.'),
      name: z.string().optional().describe('Optional sender display name.'),
      label: z.string().optional().describe('Optional Gmail label name to apply to the draft. If the label does not exist it will be created automatically.'),
    },
    async ({ to, subject, body, htmlBody, cc, bcc, replyTo, name, label }) => {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body, htmlBody, cc, bcc, replyTo, name, label }),
      });
      const result = await response.json();
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`BTC Outreach MCP running on port ${PORT}`));
