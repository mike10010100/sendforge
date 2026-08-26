/**
 * Cloudflare Pages Functions Request Handler for Pull Request Submission:
 * POST /api/submit/pr
 */

import type {
  AuthorRecord,
  EdgeEnv,
  PagesFunctionContext,
  PRSubmitResponse,
  PullRequestRecord,
} from './types.js';
import {
  getStorageBackend,
  isPathTraversal,
  sanitizeId,
  saveGitLooseBlob,
  savePRMetadata,
  type StorageBackend,
  updateGitRef,
  validateRepoName,
} from './storage.js';

interface RawAuthorInput {
  readonly name?: unknown;
  readonly email?: unknown;
}

interface RawPRPayload {
  readonly repo?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly author?: unknown;
  readonly source_branch?: unknown;
  readonly sourceBranch?: unknown;
  readonly target_branch?: unknown;
  readonly targetBranch?: unknown;
  readonly head_commit?: unknown;
  readonly headCommit?: unknown;
  readonly patch?: unknown;
  readonly labels?: unknown;
  readonly custom_id?: unknown;
  readonly id?: unknown;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(body: PRSubmitResponse, status = 200): Response {
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

function validateBranchName(branch: string, fieldName: string): { readonly valid: boolean; readonly error?: string } {
  const trimmed = branch.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: `Field "${fieldName}" cannot be empty` };
  }
  if (isPathTraversal(trimmed)) {
    return { valid: false, error: `Path traversal detected in ${fieldName}` };
  }
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 32 || code === 127) {
      return { valid: false, error: `Invalid control character in ${fieldName}` };
    }
  }
  if (/[ ~^:?*[@\\]/.test(trimmed)) {
    return { valid: false, error: `Invalid characters in ${fieldName}: "${trimmed}"` };
  }
  return { valid: true };
}

/**
 * Core handler for pull request submission requests.
 */
export async function handlePRSubmission(
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
  let payload: RawPRPayload;
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
    return jsonResponse({ success: false, error: 'Pull request title cannot be empty' }, 400);
  }
  if (cleanTitle.length > 255) {
    return jsonResponse({ success: false, error: 'Pull request title exceeds 255 character limit' }, 400);
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

  // 4. Validate Source Branch
  const rawSourceBranch = payload.source_branch ?? payload.sourceBranch;
  if (typeof rawSourceBranch !== 'string') {
    return jsonResponse({ success: false, error: 'Field "source_branch" is required and must be a string' }, 400);
  }
  const sourceValidation = validateBranchName(rawSourceBranch, 'source_branch');
  if (!sourceValidation.valid) {
    return jsonResponse({ success: false, error: sourceValidation.error ?? 'Invalid source branch' }, 400);
  }
  const sourceBranch = rawSourceBranch.trim();

  // 5. Validate Target Branch
  const rawTargetBranch = payload.target_branch ?? payload.targetBranch ?? 'main';
  if (typeof rawTargetBranch !== 'string') {
    return jsonResponse({ success: false, error: 'Field "target_branch" must be a string' }, 400);
  }
  const targetValidation = validateBranchName(rawTargetBranch, 'target_branch');
  if (!targetValidation.valid) {
    return jsonResponse({ success: false, error: targetValidation.error ?? 'Invalid target branch' }, 400);
  }
  const targetBranch = rawTargetBranch.trim();

  // 6. Validate Head Commit / Patch
  const rawHeadCommit = payload.head_commit ?? payload.headCommit;
  let headCommit = '';
  if (typeof rawHeadCommit === 'string') {
    headCommit = rawHeadCommit.trim();
    if (headCommit.length > 0 && !/^[0-9a-f]{40}$/i.test(headCommit)) {
      return jsonResponse({ success: false, error: 'Field "head_commit" must be a 40-character hexadecimal SHA-1 string' }, 400);
    }
  }

  let patchContent = '';
  if (payload.patch !== undefined && payload.patch !== null) {
    if (typeof payload.patch !== 'string') {
      return jsonResponse({ success: false, error: 'Field "patch" must be a string' }, 400);
    }
    if (payload.patch.length > 2097152) { // 2MB
      return jsonResponse({ success: false, error: 'Patch content exceeds 2MB limit' }, 400);
    }
    patchContent = payload.patch;
  }

  // 7. Validate Author
  const authorResult = parseAuthor(payload.author);
  if (authorResult.error || !authorResult.author) {
    return jsonResponse({ success: false, error: authorResult.error ?? 'Invalid author' }, 400);
  }
  const author = authorResult.author;

  // 8. Validate Labels
  const labelsResult = parseLabels(payload.labels);
  if (labelsResult.error || !labelsResult.labels) {
    return jsonResponse({ success: false, error: labelsResult.error ?? 'Invalid labels' }, 400);
  }
  const labels = labelsResult.labels;

  // 9. Validate & Sanitize Custom ID
  const rawId = payload.custom_id ?? payload.id;
  if (typeof rawId === 'string' && isPathTraversal(rawId)) {
    return jsonResponse({ success: false, error: 'Malicious path traversal in pull request ID' }, 400);
  }

  const storage = getStorageBackend(env, customStorage);

  // Auto-calculate next PR number
  let calculatedNumber = 1;
  try {
    const aggregateKey = repo ? `${repo}/pulls.json` : 'pulls.json';
    const existing = await storage.getJson<PullRequestRecord[]>(aggregateKey);
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
    // Continue with 1
  }

  const rawIdString = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : undefined;
  const cleanId = sanitizeId(rawIdString, String(calculatedNumber));
  const parsedNumber = parseInt(cleanId, 10);
  const pullNumber = Number.isNaN(parsedNumber) || parsedNumber <= 0 ? calculatedNumber : parsedNumber;

  try {
    // If patch is provided and headCommit is empty, synthesize a loose blob for the patch
    if (patchContent.length > 0) {
      const patchBlob = await saveGitLooseBlob(storage, repo, patchContent);
      if (!headCommit) {
        headCommit = patchBlob.oid;
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const pull: PullRequestRecord = {
      id: cleanId,
      number: pullNumber,
      title: cleanTitle,
      description: cleanDescription,
      author,
      target_branch: targetBranch,
      source_branch: sourceBranch,
      head_commit: headCommit,
      status: 'open',
      created_at: now,
      updated_at: now,
      labels,
      comments: [],
    };

    // Synthesize Git Loose Blob for PR Metadata
    const serialized = JSON.stringify(pull, null, 2) + '\n';
    const metaBlob = await saveGitLooseBlob(storage, repo, serialized);

    // Update Git Reference: refs/pull/<id>/head
    const headRef = `refs/pull/${cleanId}/head`;
    const metaRef = `refs/pull/${cleanId}/meta`;

    const resolvedHeadOid = headCommit ? headCommit.toLowerCase() : metaBlob.oid;
    await updateGitRef(storage, repo, headRef, resolvedHeadOid);
    await updateGitRef(storage, repo, metaRef, metaBlob.oid);

    // Save PR Metadata in aggregate & individual meta JSON
    await savePRMetadata(storage, repo, pull);

    return jsonResponse(
      {
        success: true,
        pull,
        ref: headRef,
        meta_ref: metaRef,
        oid: metaBlob.oid,
      },
      201
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      {
        success: false,
        error: `Failed to persist pull request to Git storage: ${message}`,
      },
      500
    );
  }
}

/**
 * Cloudflare Pages Functions HTTP POST entrypoint.
 */
export async function onRequestPost(context: PagesFunctionContext): Promise<Response> {
  return handlePRSubmission(context.request, context.env);
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
