import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import fetch from 'node-fetch';

const GAS_URL = process.env.GAS_WEB_APP_URL;
const GAS_SECRET = process.env.GAS_SHARED_SECRET;
const app = express();
app.use(express.json());

async function callGas(payload) {
  const response = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: 'Apps Script returned a non-JSON response',
      status: response.status,
      preview: text.slice(0, 300),
    };
  }
}

async function callAction(action, args) {
  if (!GAS_SECRET) {
    return { ok: false, error: 'GAS_SHARED_SECRET is not set on the MCP server' };
  }
  return callGas({ ...args, action, token: GAS_SECRET });
}

function asText(result) {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

app.get('/health', (req, res) => {
  res.json({ ok: true, name: 'btc-outreach-mcp', version: '1.3.0' });
});

app.all('/mcp', async (req, res) => {
  const server = new McpServer({
    name: 'btc-outreach-mcp',
    version: '1.3.0',
  });

  // Helper: register a tool that forwards to an Apps Script action.
  const actionTool = (name, description, shape, action) => {
    server.tool(name, description, shape, async (args) => asText(await callAction(action, args)));
  };

  // ---- Existing tool. Payload is unchanged so the current Apps Script keeps working. ----
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
      const result = await callGas({ to, subject, body, htmlBody, cc, bcc, replyTo, name, label });
      return asText(result);
    }
  );

  // ---- Read tools ----
  actionTool(
    'search_threads',
    'Search the kmeeks@blacktechcapital.com mailbox with Gmail search syntax (for example "in:sent to:name@example.com newer_than:14d"). Returns thread id, subject, last sender, last date, snippet, and labels.',
    {
      query: z.string().describe('Gmail search query.'),
      max_results: z.number().int().min(1).max(50).optional().describe('Maximum threads to return. Default 20, maximum 50.'),
    },
    'search_threads'
  );

  actionTool(
    'get_thread',
    'Read every message in a thread by thread id, with full plain-text bodies and attachment names.',
    { thread_id: z.string().describe('Thread id from search_threads.') },
    'get_thread'
  );

  actionTool(
    'get_message',
    'Read one message by message id, with full plain-text body and attachment names.',
    { message_id: z.string().describe('Message id from get_thread or list_drafts.') },
    'get_message'
  );

  actionTool(
    'list_labels',
    'List all Gmail labels in the kmeeks@blacktechcapital.com mailbox.',
    {},
    'list_labels'
  );

  // ---- Draft tools. No tool here sends mail. Keyona sends from Gmail after review. ----
  actionTool(
    'list_drafts',
    'List current drafts with draft id, recipients, subject, and date.',
    { max_results: z.number().int().min(1).max(50).optional().describe('Maximum drafts to return. Default 20.') },
    'list_drafts'
  );

  actionTool(
    'get_draft',
    'Read one draft by draft id, with full body.',
    { draft_id: z.string().describe('Draft id from list_drafts or create_reply_draft.') },
    'get_draft'
  );

  actionTool(
    'update_draft',
    'Change an existing draft. Fields you leave out keep their current values. Use <a href> anchor tags for links, never markdown.',
    {
      draft_id: z.string().describe('Draft id to change.'),
      to: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().optional().describe('Plain text or HTML. HTML is detected automatically.'),
      htmlBody: z.string().optional(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
    },
    'update_draft'
  );

  actionTool(
    'delete_draft',
    'Delete one draft by draft id. This removes the draft only. It does not delete sent mail.',
    { draft_id: z.string().describe('Draft id to delete.') },
    'delete_draft'
  );

  actionTool(
    'create_reply_draft',
    'Create a reply draft inside an existing thread, so it keeps the thread and the Re: subject. Set reply_all to true to include every recipient. Use <a href> anchor tags for links, never markdown.',
    {
      thread_id: z.string().describe('Thread id to reply in.'),
      body: z.string().describe('Reply body. Plain text or HTML. HTML is detected automatically.'),
      htmlBody: z.string().optional(),
      reply_all: z.boolean().optional().describe('Reply to all recipients. Default false.'),
      cc: z.string().optional().describe('Extra CC recipients. Comma-separated.'),
      bcc: z.string().optional().describe('BCC recipients. Comma-separated.'),
      name: z.string().optional().describe('Optional sender display name.'),
    },
    'create_reply_draft'
  );

  actionTool(
    'label_thread',
    'Add or remove a Gmail label on a thread. The label is created if it does not exist.',
    {
      thread_id: z.string().describe('Thread id.'),
      label: z.string().describe('Label name.'),
      remove: z.boolean().optional().describe('Set true to remove the label. Default false adds it.'),
    },
    'label_thread'
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`BTC Outreach MCP running on port ${PORT}`));
