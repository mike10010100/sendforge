export type GitObjectType = 'commit' | 'tree' | 'blob' | 'tag';

export type GitOid = string; // 40-character lowercase hexadecimal SHA-1 string

export interface GitIdent {
  readonly name: string;
  readonly email: string;
  readonly timestamp: number; // Unix timestamp in seconds
  readonly tzOffset: string;  // e.g. "+0000", "-0400"
}

export type GitAuthorIdent = GitIdent;

export interface GitCommitObject {
  readonly type: 'commit';
  readonly oid: GitOid;
  readonly size: number;
  readonly tree: GitOid;
  readonly parents: readonly GitOid[];
  readonly author: GitIdent;
  readonly committer: GitIdent;
  readonly gpgSig?: string;
  readonly message: string;
  readonly subject: string;
  readonly body: string;
}

export type GitFileMode =
  | '100644'
  | '100664'
  | '100755'
  | '120000'
  | '040000'
  | '160000';

export interface GitTreeEntry {
  readonly mode: GitFileMode;
  readonly name: string;
  readonly oid: GitOid;
  readonly isTree: boolean;
  readonly isSubmodule: boolean;
  readonly isSymlink: boolean;
}

export interface GitTreeObject {
  readonly type: 'tree';
  readonly oid: GitOid;
  readonly size: number;
  readonly entries: readonly GitTreeEntry[];
}

export interface GitBlobObject {
  readonly type: 'blob';
  readonly oid: GitOid;
  readonly size: number;
  readonly data: Uint8Array;
  readonly isBinary: boolean;
  readonly text?: string;
}

export interface GitTagObject {
  readonly type: 'tag';
  readonly oid: GitOid;
  readonly size: number;
  readonly targetOid: GitOid;
  readonly targetType: GitObjectType;
  readonly tagName: string;
  readonly tagger?: GitIdent;
  readonly message: string;
  readonly gpgSig?: string;
}

export type GitObject =
  | GitCommitObject
  | GitTreeObject
  | GitBlobObject
  | GitTagObject;

export interface RepoBranch {
  readonly name: string;
  readonly target: GitOid;
  readonly is_default: boolean;
  readonly latest_commit_date?: string | undefined;
}

export interface RepoTag {
  readonly name: string;
  readonly target: GitOid;
  readonly is_annotated: boolean;
  readonly peeled: GitOid | null;
  readonly peeled_target?: string | null | undefined;
  readonly tagger?: {
    readonly name: string;
    readonly email: string;
    readonly timestamp: number;
    readonly date?: string | undefined;
  } | null | undefined;
  readonly message?: string | null | undefined;
}

export interface RepoHead {
  readonly ref: string;
  readonly sha: GitOid;
}

export interface RepoStats {
  readonly commit_count: number;
  readonly branch_count: number;
  readonly tag_count: number;
}

export interface RepoMeta {
  readonly name: string;
  readonly description: string | null;
  readonly default_branch: string;
  readonly branches: readonly RepoBranch[];
  readonly tags: readonly RepoTag[];
  readonly head: RepoHead;
  readonly stats: RepoStats;
  readonly has_readme: boolean;
  readonly readme_filename: string | null;
  readonly updated_at: string;
}
