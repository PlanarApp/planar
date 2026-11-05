import type { ComputedRef, InjectionKey, Ref, ShallowRef } from 'vue';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';

/** What the comment threads of the task feed share (Feed provides, CommentThread injects at any depth). */
export interface FeedCtx {
  replies: ComputedRef<Map<string, Row<'comments'>[]>>;
  replyTo: Ref<string | null>;
  replyDraft: ShallowRef<JSONContent | null>;
  sendReply: () => Promise<void>;
  userId: () => string | undefined;
  names: ComputedRef<Record<string, string>>;
  members: ComputedRef<{ id: string; name: string }[]>;
  reactions: Readonly<Ref<Row<'commentReactions'>[] | undefined>>;
  nameOf: (id: string) => string;
  avatarOf: (id: string) => string | null;
  canResolve: (c: Row<'comments'>) => boolean;
  react: (commentId: string, emoji: string) => unknown;
}
export const FEED: InjectionKey<FeedCtx> = Symbol('feed');
