import { randomUUID } from 'node:crypto';
import type { Project, Snapshot, SourceNode } from '../shared/contracts.js';
import { DEMO_PREVIEWS } from './previews.js';

/** Entirely generated content. Never substitutes for a captured real Figma file. */
export function createDemoProject(): Project {
  const capturedAt = new Date().toISOString();
  const makeNode = (id: string, parentId: string | null, type: string, name: string, x: number, y: number, width: number, height: number, text?: string): SourceNode => ({
    id, parentId, type, name, bbox: { x, y, width, height }, visible: true,
    sourceFileKey: 'generated-demo', sourcePageId: 'demo-page', ...(text === undefined ? {} : { text }),
  });
  const ui: Snapshot = {
    schemaVersion: '1.0.0', id: 'demo-ui', name: 'Workspace / Members',
    source: { fileKey: 'generated-demo', pageId: 'demo-page', rootId: 'screen', revision: 'generator-v1', capturedAt },
    bounds: { x: 100, y: 100, width: 980, height: 650 }, preview: { mimeType: 'image/png', base64: DEMO_PREVIEWS.ui, width: 980, height: 650 },
    completeness: { complete: true, reason: null }, warnings: ['Generated demonstration; not a connected Figma document.'],
    nodes: [
      makeNode('screen', null, 'FRAME', 'Members screen', 100, 100, 980, 650),
      makeNode('sidebar', 'screen', 'RECTANGLE', 'Navigation background', 100, 100, 180, 650),
      makeNode('brand', 'screen', 'TEXT', 'Brand', 124, 130, 130, 26, 'WORKSPACE'),
      makeNode('nav-label', 'screen', 'TEXT', 'Members navigation', 124, 220, 130, 28, 'Members'),
      makeNode('heading', 'screen', 'TEXT', 'Page title', 320, 140, 420, 45, 'Team members'),
      makeNode('subtitle', 'screen', 'TEXT', 'Page description', 320, 190, 500, 24, 'Manage access to your workspace.'),
      makeNode('invite-bg', 'screen', 'RECTANGLE', 'Invite action', 880, 145, 160, 44),
      makeNode('invite-label', 'screen', 'TEXT', 'Invite label', 895, 155, 130, 24, 'Invite member'),
      makeNode('search-bg', 'screen', 'RECTANGLE', 'Search field', 320, 250, 480, 48),
      makeNode('search-label', 'screen', 'TEXT', 'Search placeholder', 340, 262, 400, 24, 'Search team members'),
      makeNode('role-bg', 'screen', 'RECTANGLE', 'Role selector', 820, 250, 220, 48),
      makeNode('role-label', 'screen', 'TEXT', 'Role label', 840, 262, 160, 24, 'All roles'),
      makeNode('table-bg', 'screen', 'RECTANGLE', 'Table surface', 320, 330, 720, 300),
      makeNode('table-title', 'screen', 'TEXT', 'Table heading', 340, 350, 620, 24, 'Member                       Role                 Status'),
      makeNode('row-a', 'screen', 'TEXT', 'First row', 340, 410, 620, 24, 'Example Alpha             Admin              Active'),
      makeNode('row-b', 'screen', 'TEXT', 'Second row', 340, 480, 620, 24, 'Example Beta               Editor               Invited'),
      makeNode('row-c', 'screen', 'TEXT', 'Third row', 340, 550, 620, 24, 'Example Gamma           Viewer              Suspended'),
      makeNode('pagination', 'screen', 'TEXT', 'Pagination', 900, 660, 130, 24, '1    2    3    →'),
    ],
  };
  const notes: Snapshot = {
    schemaVersion: '1.0.0', id: 'demo-notes', name: 'Behavior / Specifications',
    source: { fileKey: 'generated-demo', pageId: 'demo-page', rootId: 'notes', revision: 'generator-v1', capturedAt },
    bounds: { x: 1150, y: 100, width: 540, height: 650 }, preview: { mimeType: 'image/png', base64: DEMO_PREVIEWS.notes, width: 540, height: 650 },
    completeness: { complete: true, reason: null }, warnings: ['Generated specification examples; review associations yourself.'],
    nodes: [
      makeNode('notes', null, 'FRAME', 'Behavior notes', 1150, 100, 540, 650),
      makeNode('spec-title', 'notes', 'TEXT', 'Specification heading', 1180, 135, 460, 40, 'Member management — behavior'),
      makeNode('spec-search', 'notes', 'TEXT', 'Search behavior', 1180, 220, 460, 70, 'Search runs on Enter. Minimum input is 2 characters.'),
      makeNode('spec-filter', 'notes', 'TEXT', 'Shared filter behavior', 1180, 330, 460, 70, 'Changing a role filter resets pagination and clears row selection.'),
      makeNode('spec-permission', 'notes', 'TEXT', 'Permission constraint', 1180, 440, 460, 70, 'Suspended members cannot be edited. Only admins may invite new members.'),
      makeNode('spec-empty', 'notes', 'TEXT', 'Empty state', 1180, 550, 460, 70, 'When no members match, show an empty state and keep the active filters visible.'),
    ],
  };
  return { schemaVersion: '1.0.0', id: randomUUID(), name: 'Workspace demo', revision: 0, updatedAt: capturedAt,
    snapshots: [ui, notes], annotations: [], specifications: [], proposals: [] };
}
