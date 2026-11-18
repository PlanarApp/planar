import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import type { DraftFiles } from './commentFiles';

/** What the comment threads of the task feed share (Feed provides, CommentThread injects at any depth). */
export interface FeedCtx {
  replies: ComputedRef<Map<string, Row<'comments'>[]>>;
  replyTo: Ref<string | null>;
  replyDraft: ShallowRef<JSONContent | null>;
  sendReply: () => Promise<void>;
  /** files of the reply being written (PLNRAPP-372) */
  replyFiles: DraftFiles;
  /** files of a comment (the same empty array when none) */
  filesOf: (commentId: string) => Row<'attachments'>[];
  userId: () => string | undefined;
  names: ComputedRef<Record<string, string>>;
  members: ComputedRef<{ id: string; name: string; avatar: string | null }[]>;
  /** reactions of a comment, grouped once per feed change (the same empty array when none) */
  reactionsOf: (commentId: string) => Row<'commentReactions'>[];
  nameOf: (id: string) => string;
  avatarOf: (id: string) => string | null;
  canResolve: (c: Row<'comments'>) => boolean;
  react: (commentId: string, emoji: string) => unknown;
  /** ids of collapsed comments (PLNRAPP-194): the feed collapses and expands all at once */
  folded: Ref<Set<string>>;
  /** opens the thread of a comment on the whole feed (PLNRAPP-201): replies deeper than one level live there */
  openThread: (id: string) => void;
}
export const FEED: InjectionKey<FeedCtx> = Symbol('feed');

/** Selected text → a task or a subtask of the open one (PLNRAPP-144): TaskDetail provides, Editor injects; → href of the task. */
export const TO_TASK: InjectionKey<(title: string, sub: boolean) => Promise<string | null>> =
  Symbol('toTask');
