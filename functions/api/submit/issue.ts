/**
 * Cloudflare Pages Functions Request Handler for Issue Submission:
 * POST /api/submit/issue
 */

import type {
  AuthorRecord,
  EdgeEnv,
  IssueRecord,
  IssueSubmitResponse,
  PagesFunctionContext,
} from './types.js';
import {
  getStorageBackend,
  isPathTraversal,
  sanitizeId,
  saveGitLooseBlob,
  saveIssueMetadata,
  type StorageBackend,
  updateGitRef,
  validateRepoName,
} from './storage.js';

interface RawAuthorInput {
  readonly name?: unknown;
  readonly email?: unknown;
}

interface RawIssuePayload {
  readonly repo?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly author?: unknown;
  readonly labels?: unknown;
  readonly custom_id?: unknown;
  readonly id?: unknown;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(body: IssueSubmitResponse, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function parseAuthor(raw: unknown): { readonly author?: AuthorRecord; readonly error?: string } {
  if (raw === undefined || raw === null) {
    return {
      author: {
        name: 'Anonymous',
        email: 'anonymous@sendforge.local',
      },
    };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return { error: 'Author string cannot be empty' };
    }
    if (trimmed.length > 100) {
      return { error: 'Author name exceeds 100 character limit' };
    }
    return {
      author: {
        name: trimmed,
        email: 'anonymous@sendforge.local',
      },
    };
  }

  if (typeof raw === 'object') {
    const obj = raw as RawAuthorInput;
    const nameVal = obj.name;
    const emailVal = obj.email;

    if (typeof nameVal !== 'string' || nameVal.trim().length === 0) {
      return { error: 'Author object must have a non-empty string "name"' };
    }
    const name = nameVal.trim();
    if (name.length > 100) {
      return { error: 'Author name exceeds 100 character limit' };
    }

    let email = 'anonymous@sendforge.local';
    if (emailVal !== undefined && emailVal !== null) {
      if (typeof emailVal !== 'string') {
        return { error: 'Author "email" must be a string' };
      }
      email = emailVal.trim();
      if (email.length > 150) {
        return { error: 'Author email exceeds 150 character limit' };
      }
    }

    return {
      author: { name, email },
    };
  }

  return { error: 'Author must be a string or object with name and optional email' };
}

function parseLabels(raw: unknown): { readonly labels?: readonly string[]; readonly error?: string } {
  if (raw === undefined || raw === null) {
    return { labels: [] };
  }
  if (!Array.isArray(raw)) {
    return { error: 'Labels must be an array of strings' };
  }
  if (raw.length > 30) {
    return { error: 'Exceeded maximum limit of 30 labels' };
  }

  const result: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      return { error: 'All label items must be strings' };
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.length > 50) {
      return { error: `Label "${trimmed.slice(0, 20)}..." exceeds 50 character limit` };
    }
    if (!result.includes(trimmed)) {
      result.push(trimmed);
    }
  }

  return { labels: result };
}

/**
 * Core handler for issue submission requests.
 */
export async function handleIssueSubmission(
  request: Request,
  env?: EdgeEnv,
  customStorage?: StorageBackend
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { success: false, error: `Method ${request.method} not allowed` },
      405
    );
  }

  // Parse JSON Body
  let payload: RawIssuePayload;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== 'object' || raw === null) {
      return jsonResponse({ success: false, error: 'Request body must be a valid JSON object' }, 400);
    }
    payload = raw;
  } catch {
    return jsonResponse({ success: false, error: 'Malformed JSON payload' }, 400);
  }

  // 1. Validate Repo Name
  const rawRepo = typeof payload.repo === 'string' ? payload.repo : undefined;
  const repoValidation = validateRepoName(rawRepo);
  if (!repoValidation.valid) {
    return jsonResponse({ success: false, error: repoValidation.error ?? 'Invalid repository name' }, 400);
  }
  const repo = repoValidation.normalized;

  // 2. Validate Title
  if (typeof payload.title !== 'string') {
    return jsonResponse({ success: false, error: 'Field "title" is required and must be a string' }, 400);
  }
  const cleanTitle = payload.title.trim();
  if (cleanTitle.length === 0) {
    return jsonResponse({ success: false, error: 'Issue title cannot be empty' }, 400);
  }
  if (cleanTitle.length > 255) {
    return jsonResponse({ success: false, error: 'Issue title exceeds 255 character limit' }, 400);
  }

  // 3. Validate Description
  let cleanDescription = '';
  if (payload.description !== undefined && payload.description !== null) {
    if (typeof payload.description !== 'string') {
      return jsonResponse({ success: false, error: 'Field "description" must be a string' }, 400);
    }
    if (payload.description.length > 65536) {
      return jsonResponse({ success: false, error: 'Description exceeds 65,536 character limit' }, 400);
    }
    cleanDescription = payload.description.trim();
  }

  // 4. Validate Author
  const authorResult = parseAuthor(payload.author);
  if (authorResult.error || !authorResult.author) {
    return jsonResponse({ success: false, error: authorResult.error ?? 'Invalid author' }, 400);
  }
  const author = authorResult.author;

  // 5. Validate Labels
  const labelsResult = parseLabels(payload.labels);
  if (labelsResult.error || !labelsResult.labels) {
    return jsonResponse({ success: false, error: labelsResult.error ?? 'Invalid labels' }, 400);
  }
  const labels = labelsResult.labels;

  // 6. Validate & Sanitize Custom ID
  const rawId = payload.custom_id ?? payload.id;
  if (typeof rawId === 'string' && isPathTraversal(rawId)) {
    return jsonResponse({ success: false, error: 'Malicious path traversal in issue ID' }, 400);
  }

  const storage = getStorageBackend(env, customStorage);

  // Auto-calculate next number if not given
  let calculatedNumber = 1;
  try {
    const aggregateKey = repo ? `${repo}/issues.json` : 'issues.json';
    const existing = await storage.getJson<IssueRecord[]>(aggregateKey);
    if (Array.isArray(existing)) {
      let maxNum = 0;
      for (const item of existing) {
        if (typeof item.number === 'number') {
          if (item.number > maxNum) maxNum = item.number;
        }
      }
      calculatedNumber = maxNum + 1;
    }
  } catch {
    // If aggregate cannot be read, continue with 1
  }

  const rawIdString = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : undefined;
  const cleanId = sanitizeId(rawIdString, String(calculatedNumber));
  const parsedNumber = parseInt(cleanId, 10);
  const issueNumber = Number.isNaN(parsedNumber) || parsedNumber <= 0 ? calculatedNumber : parsedNumber;

  const now = Math.floor(Date.now() / 1000);
  const issue: IssueRecord = {
    id: cleanId,
    number: issueNumber,
    title: cleanTitle,
    description: cleanDescription,
    author,
    status: 'open',
    created_at: now,
    updated_at: now,
    labels,
    comments: [],
  };

  try {
    // Synthesize Git Loose Blob
    const serialized = JSON.stringify(issue, null, 2) + '\n';
    const { oid } = await saveGitLooseBlob(storage, repo, serialized);

    // Update Git Reference: refs/issues/<id>
    const refName = `refs/issues/${cleanId}`;
    await updateGitRef(storage, repo, refName, oid);

    // Save Issue Metadata in aggregate & individual meta JSON
    await saveIssueMetadata(storage, repo, issue);

    return jsonResponse(
      {
        success: true,
        issue,
        ref: refName,
        oid,
      },
      201
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      {
        success: false,
        error: `Failed to persist issue to Git storage: ${message}`,
      },
      500
    );
  }
}

/**
 * Cloudflare Pages Functions HTTP POST entrypoint.
 */
export async function onRequestPost(context: PagesFunctionContext): Promise<Response> {
  return handleIssueSubmission(context.request, context.env);
}

/**
 * Cloudflare Pages Functions HTTP OPTIONS preflight entrypoint.
 */
export function onRequestOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * Generic onRequest fallback router.
 */
export async function onRequest(context: PagesFunctionContext): Promise<Response> {
  if (context.request.method === 'POST') {
    return onRequestPost(context);
  }
  if (context.request.method === 'OPTIONS') {
    return Promise.resolve(onRequestOptions());
  }
  return jsonResponse(
    { success: false, error: `Method ${context.request.method} not allowed` },
    405
  );
}
