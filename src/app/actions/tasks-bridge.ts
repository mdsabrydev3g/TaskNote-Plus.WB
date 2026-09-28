"use server";

/**
 * Client-facing bridge for task, content and AI server actions.
 *
 * A `"use server"` module may only export async functions, and modules that mix
 * actions with plain values (helpers, constants, types) cannot be imported into
 * client components without dragging server-only code into the client bundle.
 *
 * This module is the single, narrow surface client components talk to: it
 * declares one thin async wrapper per action and re-exports the shared types as
 * type-only exports (erased at compile time, so they never violate the rule).
 */

import {
  captureAction,
  checkInGoalAction,
  createEventAction,
  createGoalAction,
  createNoteAction,
  createProjectAction,
  createTaskAction,
  deleteCaptureAction,
  deleteEventAction,
  deleteNoteAction,
  deleteProjectAction,
  deleteTaskAction,
  linkTasksToGoalAction,
  routeCaptureAction,
  toggleTaskAction,
  updateEventAction,
  updateGoalAction,
  updateNoteAction,
  updateProjectAction,
  updateTaskAction,
} from "./content";

import {
  askAssistantAction,
  confirmExtractedTasksAction,
  deleteMemoryAction,
  deleteThreadAction,
  extractTasksAction,
  generateBriefAction,
  getAiStatusAction,
  getThreadAction,
  listAiActivityAction,
  listMemoryAction,
  listPermissionsAction,
  listThreadsAction,
  parseQuickAddAction,
  savePermissionsAction,
  setPermissionAction,
  suggestCaptureDestinationAction,
  summarizeNoteAction,
  undoAiActionAction,
} from "./ai";

export type { ProposedTask, QuickAddProposal } from "./ai";

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export async function createTask(input: unknown) {
  return createTaskAction(input);
}

export async function updateTask(id: string, input: unknown) {
  return updateTaskAction(id, input);
}

export async function toggleTask(id: string) {
  return toggleTaskAction(id);
}

export async function deleteTask(id: string) {
  return deleteTaskAction(id);
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export async function createNote(input: unknown) {
  return createNoteAction(input);
}

export async function updateNote(id: string, input: unknown) {
  return updateNoteAction(id, input);
}

export async function deleteNote(id: string) {
  return deleteNoteAction(id);
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export async function createProject(input: unknown) {
  return createProjectAction(input);
}

export async function updateProject(id: string, input: unknown) {
  return updateProjectAction(id, input);
}

export async function deleteProject(id: string) {
  return deleteProjectAction(id);
}

/* ------------------------------------------------------------------ */
/* Goals                                                               */
/* ------------------------------------------------------------------ */

export async function createGoal(input: unknown) {
  return createGoalAction(input);
}

export async function updateGoal(id: string, input: unknown) {
  return updateGoalAction(id, input);
}

export async function checkInGoal(id: string) {
  return checkInGoalAction(id);
}

export async function linkTasksToGoal(goalId: string, taskIds: string[]) {
  return linkTasksToGoalAction(goalId, taskIds);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export async function createEvent(input: unknown) {
  return createEventAction(input);
}

export async function updateEvent(id: string, input: unknown) {
  return updateEventAction(id, input);
}

export async function deleteEvent(id: string) {
  return deleteEventAction(id);
}

/* ------------------------------------------------------------------ */
/* Captures                                                            */
/* ------------------------------------------------------------------ */

export async function capture(input: unknown) {
  return captureAction(input);
}

export async function routeCapture(
  captureId: string,
  target: { type: "task" | "note" | "event"; title?: string },
) {
  return routeCaptureAction(captureId, target);
}

export async function deleteCapture(id: string) {
  return deleteCaptureAction(id);
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

export async function aiStatus() {
  return getAiStatusAction();
}

export async function parseQuickAdd(text: string) {
  return parseQuickAddAction(text);
}

export async function summarizeNote(noteId: string) {
  return summarizeNoteAction(noteId);
}

export async function extractTasks(noteId: string) {
  return extractTasksAction(noteId);
}

export async function confirmExtractedTasks(
  noteId: string,
  aiLogId: string,
  proposals: import("./ai").ProposedTask[],
  projectId?: string | null,
) {
  return confirmExtractedTasksAction(noteId, aiLogId, proposals, projectId);
}

export async function suggestCaptureDestination(captureId: string) {
  return suggestCaptureDestinationAction(captureId);
}

export async function generateBrief(kind: "daily" | "weekly") {
  return generateBriefAction(kind);
}

export async function askAssistant(input: unknown) {
  return askAssistantAction(input);
}

export async function listThreads() {
  return listThreadsAction();
}

export async function getThread(threadId: string) {
  return getThreadAction(threadId);
}

export async function deleteThread(threadId: string) {
  return deleteThreadAction(threadId);
}

export async function listAiActivity(limit = 30) {
  return listAiActivityAction(limit);
}

export async function undoAiAction(aiLogId: string) {
  return undoAiActionAction(aiLogId);
}

export async function listPermissions() {
  return listPermissionsAction();
}

export async function setPermission(scope: string, granted: boolean) {
  return setPermissionAction(scope, granted);
}

/** Persist the whole permission set at once (the settings Save button). */
export async function savePermissions(scopes: string[]) {
  return savePermissionsAction(scopes);
}

export async function listMemory() {
  return listMemoryAction();
}

export async function deleteMemory(memoryId: string) {
  return deleteMemoryAction(memoryId);
}
