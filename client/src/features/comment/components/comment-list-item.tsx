import { Group, Avatar, Text, Box } from '@mantine/core';
import React, { useState } from 'react';
import classes from './comment.module.css';
import { useAtomValue } from 'jotai';
import { timeAgo } from '@/lib/time-ago';
import CommentEditor from '@/features/comment/components/comment-editor';
import { editorAtom } from '@/features/editor/atoms/editorAtom';
import CommentActions from '@/features/comment/components/comment-actions';
import CommentMenu from '@/features/comment/components/comment-menu';
import ResolveComment from '@/features/comment/components/resolve-comment';
import { useHover } from '@mantine/hooks';
import { useDeleteCommentMutation, useUpdateCommentMutation } from '@/features/comment/queries/comment';
import { IComment } from '@/features/comment/types/comment.types';

interface CommentListItemProps {
  comment: IComment;
}

function CommentListItem({ comment }: CommentListItemProps) {
  const { hovered, ref } = useHover();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const editor = useAtomValue(editorAtom);
  const [content, setContent] = useState(comment.content);
  const updateCommentMutation = useUpdateCommentMutation();
  const deleteCommentMutation = useDeleteCommentMutation(comment.pageId);

  async function handleUpdateComment() {
    try {
      setIsLoading(true);
      const commentToUpdate = {
        id: comment.id,
        content: JSON.stringify(content),
      };
      await updateCommentMutation.mutateAsync(commentToUpdate);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to update comment:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDeleteComment() {
    try {
      await deleteCommentMutation.mutateAsync(comment.id);
      editor?.commands.unsetComment(comment.id);
    } catch (error) {
      console.error('Failed to delete comment:', error);
    }
  }

  function handleEditToggle() {
    setIsEditing(true);
  }

  return (
    <Box ref={ref} pb="xs">
      <Group>
        {comment.creator.avatarUrl ? (
          <Avatar
            src={comment.creator.avatarUrl}
            alt={comment.creator.name}
            size="sm"
            radius="xl"
          />) : (
          <Avatar size="sm" color="blue">{comment.creator.name.charAt(0)}</Avatar>
        )}

        <div style={{ flex: 1 }}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" fw={500} lineClamp={1}>{comment.creator.name}</Text>

            <div style={{ visibility: hovered ? 'visible' : 'hidden' }}>
              {!comment.parentCommentId && (
                <ResolveComment commentId={comment.id} pageId={comment.pageId} resolvedAt={comment.resolvedAt} />
              )}

              <CommentMenu commentId={comment.id}
                           onEditComment={handleEditToggle}
                           onDeleteComment={handleDeleteComment} />
            </div>
          </Group>

          <Text size="xs" fw={500} c="dimmed">
            {timeAgo(comment.createdAt)}
          </Text>
        </div>
      </Group>

      <div>
        {!comment.parentCommentId && comment?.selection &&
          <Box className={classes.textSelection}>
            <Text size="sm">{comment?.selection}</Text>
          </Box>
        }

        {
          !isEditing ?
            (<CommentEditor defaultContent={content} editable={false} />)
            :
            (<>
              <CommentEditor defaultContent={content} editable={true} onUpdate={(newContent) => setContent(newContent)}
                             autofocus={true} />

              <CommentActions onSave={handleUpdateComment} isLoading={isLoading} />
            </>)
        }

      </div>

    </Box>
  );
}

export default CommentListItem;
