/**
 * McpActions.gs
 * Add this file to the Apps Script project that backs the BTC Outreach web app
 * (BlackTech Capital Google account, kmeeks@blacktechcapital.com).
 *
 * SETUP (once):
 * 1. Add this file to the project.
 * 2. In the existing doPost(e), make this the FIRST two lines:
 *      var routed = mcpRoute_(e);
 *      if (routed) return routed;
 *    The old create_draft code stays below them, unchanged.
 * 3. Project Settings > Script Properties > add MCP_SECRET = the same value as
 *    GAS_SHARED_SECRET on the Railway service.
 * 4. Run mcpAuthorize() once in the editor. Accept the new Gmail permissions.
 * 5. Deploy > Manage deployments > edit the existing deployment > New version > Deploy.
 *    Keep the same deployment so the web app URL does not change.
 *
 * No action in this file sends mail. Drafts only.
 */

function mcpAuthorize() {
  // Forces the Gmail read/modify permission prompt.
  GmailApp.getUserLabels();
  GmailApp.search('in:inbox', 0, 1);
}

function mcpJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function mcpRoute_(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return null;
  }
  if (!data || !data.action) return null;
  return mcpHandleAction_(data);
}

function mcpHandleAction_(d) {
  var secret = PropertiesService.getScriptProperties().getProperty('MCP_SECRET');
  if (!secret || d.token !== secret) {
    return mcpJson_({ ok: false, error: 'unauthorized' });
  }
  try {
    switch (d.action) {
      case 'search_threads': return mcpJson_(mcpSearchThreads_(d));
      case 'get_thread': return mcpJson_(mcpGetThread_(d));
      case 'get_message': return mcpJson_(mcpGetMessage_(d));
      case 'list_labels': return mcpJson_(mcpListLabels_());
      case 'list_drafts': return mcpJson_(mcpListDrafts_(d));
      case 'get_draft': return mcpJson_(mcpGetDraft_(d));
      case 'update_draft': return mcpJson_(mcpUpdateDraft_(d));
      case 'delete_draft': return mcpJson_(mcpDeleteDraft_(d));
      case 'create_reply_draft': return mcpJson_(mcpCreateReplyDraft_(d));
      case 'label_thread': return mcpJson_(mcpLabelThread_(d));
      default: return mcpJson_({ ok: false, error: 'unknown action: ' + d.action });
    }
  } catch (err) {
    return mcpJson_({ ok: false, error: String((err && err.message) || err) });
  }
}

// ---------- helpers ----------

function mcpLooksHtml_(s) {
  return /<\s*(html|body|div|p|br|a|table|span|ul|ol|li|h[1-6])[\s>\/]/i.test(s || '');
}

function mcpPlain_(d) {
  var body = d.body || '';
  if (d.htmlBody) return body;
  if (mcpLooksHtml_(body)) {
    return body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '');
  }
  return body;
}

function mcpOpts_(d) {
  var o = {};
  var html = d.htmlBody || (mcpLooksHtml_(d.body) ? d.body : null);
  if (html) o.htmlBody = html;
  if (d.cc) o.cc = d.cc;
  if (d.bcc) o.bcc = d.bcc;
  if (d.name) o.name = d.name;
  return o;
}

function mcpLabelNames_(thread) {
  return thread.getLabels().map(function (l) { return l.getName(); });
}

function mcpMessage_(m, threadId, full) {
  var body = m.getPlainBody() || '';
  var atts = [];
  try {
    atts = m.getAttachments({ includeInlineImages: false }).map(function (a) { return a.getName(); });
  } catch (err) {}
  return {
    id: m.getId(),
    threadId: threadId,
    from: m.getFrom(),
    to: m.getTo(),
    cc: m.getCc(),
    subject: m.getSubject(),
    date: m.getDate().toISOString(),
    unread: m.isUnread(),
    attachments: atts,
    body: full ? body.slice(0, 50000) : body.slice(0, 300)
  };
}

// ---------- read actions ----------

function mcpSearchThreads_(d) {
  var max = Math.min(Number(d.max_results) || 20, 50);
  var threads = GmailApp.search(d.query, 0, max);
  return {
    ok: true,
    threads: threads.map(function (t) {
      var msgs = t.getMessages();
      var last = msgs[msgs.length - 1];
      return {
        id: t.getId(),
        subject: t.getFirstMessageSubject(),
        messageCount: t.getMessageCount(),
        lastMessageDate: t.getLastMessageDate().toISOString(),
        lastFrom: last.getFrom(),
        lastTo: last.getTo(),
        snippet: (last.getPlainBody() || '').slice(0, 200),
        unread: t.isUnread(),
        labels: mcpLabelNames_(t)
      };
    })
  };
}

function mcpGetThread_(d) {
  var t = GmailApp.getThreadById(d.thread_id);
  if (!t) return { ok: false, error: 'thread not found' };
  return {
    ok: true,
    id: t.getId(),
    subject: t.getFirstMessageSubject(),
    labels: mcpLabelNames_(t),
    messages: t.getMessages().map(function (m) { return mcpMessage_(m, t.getId(), true); })
  };
}

function mcpGetMessage_(d) {
  var m = GmailApp.getMessageById(d.message_id);
  if (!m) return { ok: false, error: 'message not found' };
  return { ok: true, message: mcpMessage_(m, m.getThread().getId(), true) };
}

function mcpListLabels_() {
  return {
    ok: true,
    labels: GmailApp.getUserLabels().map(function (l) { return l.getName(); })
  };
}

// ---------- draft actions ----------

function mcpDraftSummary_(dr, full) {
  var m = dr.getMessage();
  var out = {
    id: dr.getId(),
    messageId: m.getId(),
    to: m.getTo(),
    cc: m.getCc(),
    bcc: m.getBcc(),
    subject: m.getSubject(),
    date: m.getDate().toISOString()
  };
  if (full) {
    out.body = (m.getPlainBody() || '').slice(0, 50000);
    out.htmlBody = m.getBody();
  }
  return out;
}

function mcpListDrafts_(d) {
  var max = Math.min(Number(d.max_results) || 20, 50);
  var drafts = GmailApp.getDrafts().slice(0, max);
  return { ok: true, drafts: drafts.map(function (dr) { return mcpDraftSummary_(dr, false); }) };
}

function mcpGetDraft_(d) {
  var dr = GmailApp.getDraft(d.draft_id);
  return { ok: true, draft: mcpDraftSummary_(dr, true) };
}

function mcpUpdateDraft_(d) {
  var dr = GmailApp.getDraft(d.draft_id);
  var m = dr.getMessage();
  var to = d.to || m.getTo();
  var subject = d.subject || m.getSubject();
  var hasNewBody = (d.body !== undefined && d.body !== null) || !!d.htmlBody;
  var plain = hasNewBody ? mcpPlain_(d) : m.getPlainBody();
  var opts = hasNewBody ? mcpOpts_(d) : { htmlBody: m.getBody() };
  if (!opts.cc) opts.cc = d.cc || m.getCc();
  if (!opts.bcc) opts.bcc = d.bcc || m.getBcc();
  var updated = dr.update(to, subject, plain, opts);
  return { ok: true, draft: mcpDraftSummary_(updated, false) };
}

function mcpDeleteDraft_(d) {
  var dr = GmailApp.getDraft(d.draft_id);
  dr.deleteDraft();
  return { ok: true, deleted: d.draft_id };
}

function mcpCreateReplyDraft_(d) {
  var t = GmailApp.getThreadById(d.thread_id);
  if (!t) return { ok: false, error: 'thread not found' };
  var plain = mcpPlain_(d);
  var opts = mcpOpts_(d);
  var draft = d.reply_all ? t.createDraftReplyAll(plain, opts) : t.createDraftReply(plain, opts);
  return { ok: true, draft: mcpDraftSummary_(draft, false), threadId: t.getId() };
}

// ---------- labels ----------

function mcpLabelThread_(d) {
  var t = GmailApp.getThreadById(d.thread_id);
  if (!t) return { ok: false, error: 'thread not found' };
  var label = GmailApp.getUserLabelByName(d.label) || GmailApp.createLabel(d.label);
  if (d.remove) {
    t.removeLabel(label);
  } else {
    t.addLabel(label);
  }
  return { ok: true, threadId: t.getId(), labels: mcpLabelNames_(t) };
}
